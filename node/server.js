var args = require('minimist')(process.argv.slice(2), {
    'default': {
      'rules': process.env.rules
    }
  }),
  rules = require(args.rules),
  express = require('express'),
  path = require('path'),
  https = require('https'),
  pem = require('pem'),
  app = express(),
  bodyParser = require('body-parser'),
  staticDir = process.env.static || './build/static';

// push state returns index.html
function sendIndex(req, res) {
  var file = path.join(__dirname, '..', staticDir, req.baseUrl === '/sandbox' ? 'sandbox.html' : 'proxy.html');
  console.log('INDEX req: '+ req.originalUrl +' -> res: '+ file);
  res.sendFile(file);
}

console.log('args: '+ JSON.stringify(args));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(/^\/$/, sendIndex);
app.use(['/racing', '/sports', '/sandbox'], sendIndex);
app.use(['/login/success', '/logout/success'], sendIndex);

app.use('/', require('./routes/randomFile'));

console.log('server.js: static dir: ' + staticDir);
app.use(express.static(path.join(__dirname, '..', staticDir)));

// shared static resources
app.use(express.static(path.join(__dirname, '..', 'shared_resources')));

app.set('port', rules.http || 3001);


// run https
pem.createCertificate({days: 1, selfSigned: true}, function (err, keys) {
  if (err) throw err;
  console.log('server is attempting to listen port %d', rules.https);
  https.createServer({key: keys.serviceKey, cert: keys.certificate}, app).listen(rules.https, function() {
    console.log('server is listening on %d', rules.https);

    // run http
    console.log('server is attempting to listen port %d', app.get('port'));
    app.listen(app.get('port'), function () {
      console.log('server is listening on %d', app.get('port'));
      process.send && process.send('started');
    });
  });
});

process.on('uncaughtException', function (error) {
  console.error('UNCAUGHT EXCEPTION');
  console.error(error.stack);
  process.exit(1);
});
