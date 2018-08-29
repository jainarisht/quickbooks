/**
 *  Quickbooks CRUD Logger
 *
 *  Copyright 2018 Xooa
 *
 *  Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 *  in compliance with the License. You may obtain a copy of the License at:
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software distributed under the License is distributed
 *  on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License
 *  for the specific language governing permissions and limitations under the License.
 */
/*
 * Original source via IBM Corp:
 *  https://hyperledger-fabric.readthedocs.io/en/release-1.2/chaincode4ade.html#pulling-it-all-together
 *
 * Modifications from: Arisht Jain:
 *  https://github.com/xooa/quickBooks-xooa
 *
 * Changes:
 *  Logs to Xooa blockchain platform from QuickBooks instead from user
 */

package main

import (
	"bytes"
	"fmt"
	"strings"

	"github.com/hyperledger/fabric/core/chaincode/shim"
	"github.com/hyperledger/fabric/protos/peer"
)

// SimpleAsset implements a simple chaincode to manage an asset
type SimpleAsset struct {
}

// Init is called during chaincode instantiation to initialize any
// data. Note that chaincode upgrade also calls this function to reset
// or to migrate data.
func (t *SimpleAsset) Init(stub shim.ChaincodeStubInterface) peer.Response {
	return shim.Success(nil)
}

// Invoke is called per transaction on the chaincode. Each transaction is
// either updating the state or retreiving the state created by Init function.
func (t *SimpleAsset) Invoke(stub shim.ChaincodeStubInterface) peer.Response {
	// Extract the function and args from the transaction proposal
	function, args := stub.GetFunctionAndParameters()

	if function == "saveNewEvent" {
		return t.saveNewEvent(stub, args)
	} else if function == "getEntityDetails" {
		return t.getEntityDetails(stub, args)
	} else if function == "getHistoryForEntity" {
		return t.getHistoryForEntity(stub, args)
	}

	return shim.Error("Invalid function name for 'invoke'")
}

// saveNewEvent stores the event on the ledger. For each device
// it will override the current state with the new one
func (t *SimpleAsset) saveNewEvent(stub shim.ChaincodeStubInterface, args []string) peer.Response {
	if len(args) != 4 {
		return shim.Error("incorrect arguments. Expecting full details")
	}
	realmId := strings.ToLower(args[0])
	entity := strings.ToLower(args[1])
	key := strings.ToLower(args[2])
	arr := []string{realmId, entity, key}
	myCompositeKey, err := stub.CreateCompositeKey("combined", arr)
	eventJSONasString := strings.ToLower(args[3])
	eventJSONasBytes := []byte(eventJSONasString)

	err = stub.PutState(myCompositeKey, eventJSONasBytes)
	if err != nil {
		return shim.Error("Failed to set asset")
	}
	return shim.Success([]byte(key))
}

// main function starts up the chaincode in the container during instantiate
func main() {
	if err := shim.Start(new(SimpleAsset)); err != nil {
		fmt.Printf("Error starting SimpleAsset chaincode: %s", err)
	}
}

// getHistoryForEntity creates a rich query to query the location using locationId.
// It retrieve all the devices and their last states for that location.
func (t *SimpleAsset) getHistoryForEntity(stub shim.ChaincodeStubInterface, args []string) peer.Response {

	if len(args) != 3 {
		return shim.Error("Incorrect number of arguments. Expecting 2")
	}

	realmId := strings.ToLower(args[0])
	entity := strings.ToLower(args[1])
	key := strings.ToLower(args[2])
	arr := []string{realmId, entity, key}
	myCompositeKey, err := stub.CreateCompositeKey("combined", arr)
	resultsIterator, err := stub.GetHistoryForKey(myCompositeKey)

	if err != nil {
		return shim.Error(err.Error())
	}
	defer resultsIterator.Close()

	// buffer is a JSON array containing historic values for the marble
	var buffer bytes.Buffer
	buffer.WriteString("[")

	bArrayMemberAlreadyWritten := false
	for resultsIterator.HasNext() {
		response, err := resultsIterator.Next()
		if err != nil {
			return shim.Error(err.Error())
		}
		// Add a comma before array members, suppress it for the first array member
		if bArrayMemberAlreadyWritten == true {
			buffer.WriteString(",")
		}
		buffer.WriteString("{\"TxId\":")
		buffer.WriteString("\"")
		buffer.WriteString(response.TxId)
		buffer.WriteString("\"")

		buffer.WriteString(", \"Value\":")
		buffer.WriteString(string(response.Value))
	}
	buffer.WriteString("]")

	return shim.Success(buffer.Bytes())
}

// getEntityDetails creates a rich query to query using locationId, deviceId and date.
// It retrieves all the history of the device for a particular date.
func (t *SimpleAsset) getEntityDetails(stub shim.ChaincodeStubInterface, args []string) peer.Response {
	var jsonResp string
	var err error

	if len(args) != 3 {
		return shim.Error("Incorrect number of arguments. Expecting 2")
	}

	realmId := strings.ToLower(args[0])
	entity := strings.ToLower(args[1])
	key := strings.ToLower(args[2])
	arr := []string{realmId, entity, key}
	myCompositeKey, err := stub.CreateCompositeKey("combined", arr)

	valueAsBytes, err := stub.GetState(myCompositeKey)
	if err != nil {
		jsonResp = "{\"Error\":\"Failed to get state for " + entity + "entity with id=" + key + "\"}"
		return shim.Error(jsonResp)
	}
	if valueAsBytes == nil {
		jsonResp = "{\"Error\":\"Failed to get state for " + entity + "entity with id=" + key + "\"}"
		return shim.Error(jsonResp)
	}
	return shim.Success(valueAsBytes)
}
