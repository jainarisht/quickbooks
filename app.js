var path = require('path')
var config = require('./config.json')
var express = require('express')
var session = require('express-session')
var bodyParser = require('body-parser');
var app = express()
var util = require('./util/util');
var request = require('request')
var http = require('http');
var https = require('https');
var tools = require('./tools/tools.js')
var rp = require('request-promise');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set('views', path.join(__dirname, 'views'))
app.set('view engine', 'ejs')
app.use(express.static(path.join(__dirname, 'public')))
app.use(session({ secret: 'secret', resave: 'false', saveUninitialized: 'false' }))

const sleep = (delay) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, delay);
  })
}

// Initial view - loads Connect To QuickBooks Button
app.get('/', function (req, res) {
  res.render('home', config)
})

app.post('/webhooks', async (req, res) => {
  console.log("Post request received in webhooks");

  var payload = JSON.stringify(req.body);
  var signature = req.get('intuit-signature')

  // if signature is empty return 401
  if (!signature) {
    return res.status(401).send('FORBIDDEN');
  }
  console.log(req.body);
  // if payload is empty, don't do anything
  if (!payload) {
    return res.status(200).send('Empty payload is received');
  }

  // validate signature
  if (util.isValidPayload(signature, payload)) {
    event = req.body
    var realmId = event.eventNotifications[0].realmId
    req.session.realmId = realmId
    var token = await tools.getToken(realmId)
    if (!token)
      return res.json({ error: 'Not authorized' })
    event.eventNotifications[0].dataChangeEvent.entities.forEach(entity => {

      var url = config.api_uri + realmId + '/' + entity.name.toLowerCase() + '/' + entity.id
      console.log('Making API call to: ' + url)
      var requestObj = {
        url: url,
        headers: {
          'Authorization': 'Bearer ' + token.accessToken,
          'Accept': 'application/json'
        }
      }

      // Make API call
      request(requestObj, async (err, response) => {
        // Check if 401 response was returned - refresh tokens if so!
        const obj = await tools.checkForUnauthorized(req, requestObj, err, response)
        if (obj.err || obj.response.statusCode != 200) {
          console.log("Error occured while checking for unauthorized: " + err)
        } else {
          try {
            // Make API invoke call to Xooa chaincode to log event
            var uri = "https://api.xooa.com/api/" + config.xooaAppId + "/invoke/saveNewEvent"
            console.log('Making API call to: ', uri)
            console.log("data to log: ", obj.response.body)

            var jsonObj = { 'args': [realmId, entity.name, entity.id, obj.response.body] }
            var requestObj1 = {
              uri: uri,
              method: 'POST',
              headers: {
                'Authorization': 'Bearer ' + config.xooaAccessToken,
                'Accept': 'application/json'
              },
              body: jsonObj,
              json: true,
              resolveWithFullResponse: true
            }
            const response = await rp(requestObj1)
            if (response.statusCode < 200 || response.statusCode >= 300) {
              console.log("Error occured while logging to Xooa")
            } else if (response.statusCode == 202) {
              let requestCount = 5
              let sleepTime = 3000
              let i = 0
              let statusCode = 404
              while (i < requestCount && statusCode == 404) {
                await sleep(sleepTime);
                try {
                  // Making a get request to results api to get the latest status of transaction
                  let options = {
                    uri: `https://api.xooa.com/api/${config.xooaAppId}/results/${response.body.resultId}`,
                    method: 'GET',
                    headers: {
                      'Authorization': 'Bearer ' + config.xooaAccessToken,
                      'Accept': 'application/json'
                    },
                    json: true,
                    resolveWithFullResponse: true
                  }

                  const response2 = await rp(options)
                  statusCode = response2.statusCode
                  if (response2.statusCode == 200) {
                    // Successfully logged to xooa blockchain after returning 202 initially
                    console.log(response2.body)
                    console.log("Event successfully logged in Xooa for realmid: " + realmId + ", entity: " + entity.name + " and id: " + entity.id)
                  } else {
                    console.log("Failed to log event into Xooa chaincode.")
                  }
                } catch(err) {
                  if(err.statusCode == 404) {
                    i++
                    console.log("Going to call results API again to check for transaction status")
                    continue;
                  } else {
                    // Unable to log to Xooa blockchain
                    console.log("Event logging failed for Xooa blockchain")
                    break;
                  }
                }
              }
            } else {
              // Smoothly logged to xooa blockchain
              console.log(response.body)
              console.log("Event successfully logged in Xooa effortlessly for realmid: " + realmId + ", entity: " + entity.name + " and id: " + entity.id)
            }
          } catch (err) {
            // Unable to log to Xooa blockchain
            console.log("Error occured while logging event to xooa: " + err)
          }
        }
      });
    });
    return res.status(200).send('success');
  } else {
    console.log("FORBIDDEN");
    return res.status(401).send('FORBIDDEN');
  }

});
// Sign In With Intuit, Connect To QuickBooks, or Get App Now
// These calls will redirect to Intuit's authorization flow
app.use('/connect_to_quickbooks', require('./routes/connect_to_quickbooks.js'))

// Callback - called via redirect_uri after authorization
app.use('/callback', require('./routes/callback.js'))

// Connected - call OpenID and render connected view
app.use('/sign_in_with_intuit', require('./routes/sign_in_with_intuit.js'))
app.use('/connected', require('./routes/connected.js'))

// Call an example API over OAuth2
app.use('/api_call', require('./routes/api_call.js'))

app.get('/auth', function (req, res) {
  res.render('auth', config)
})

// Get chaincodes and identities available
app.use('/get_chaincodes', require('./routes/get_chaincodes.js'))

// Get already configured apps
app.use('/update_apps', require('./routes/update_apps'))

// Start server on HTTP (will use ngrok for HTTPS forwarding)
var httpServer = http.createServer(app);
var port = process.env.PORT || 3000;
httpServer.listen(port, function () {
  console.log('Quickbooks sample app listening on port ', port)
})
