var ldap = require('ldapjs');



///--- Shared handlers

function authorize(req, res, next) {
  /* Any user may search after bind, only cn=root has full power */
  var isSearch = (req instanceof ldap.SearchRequest);
  if (!req.connection.ldap.bindDN.equals('cn=root') && !isSearch)
    return next(new ldap.InsufficientAccessRightsError());

  return next();
}


///--- Globals

var SUFFIX = 'o=smartdc';
var db = {};
var server = ldap.createServer();


var RestClient = require('node-rest-client').Client;
var orgBaseUrl = "http://rain.okta1.com:1802";
var oktaApi = new RestClient();
var authToken = "004-egGf0SNHFOaeRvgClV5dsXF_zCz-_stRkTl4XB";
var authHeader = "SSWS " + authToken;

oktaApi.registerMethod("createSession", orgBaseUrl + "/api/v1/sessions?additionalFields=cookieToken", "POST");
oktaApi.registerMethod("getActiveUsers", orgBaseUrl + "/api/v1/users", "GET");
oktaApi.registerMethod("getSingleActiveUser", orgBaseUrl + "/api/v1/users", "GET");


// Various REST calls methods to the Okta Server

var getHeaders = {
  headers: {
    "Accept":"application/json",
    "Content-Type":"application/json",
    "Authorization": authHeader
   }
}

oktaApi.methods.getActiveUsers(getHeaders, 
  function(data, response) {
    if (response.statusCode == 200) {
        console.log("Getting list of Active Users: \n");
        console.log(response);
        console.log(data);
        //return next();
    } else {
      console.log("Wrong API Token!");
      //return next(new ldap.InvalidCredentialsError());
    }
  }).on('error',function(err) {
      console.log('something went wrong on the request', err.request.options);
      //return next(new ldap.InvalidCredentialsError());
  });

// Get individual active user
var userUID = "nadeemk"; // TODO hackers: Parameterize this or extract it from LDAP query. 
                  // This would be the login attribute on the user.

var singleUserArgs = {
  path: {"uid": userUID },
  headers: {
    "Accept":"application/json",
    "Content-Type":"application/json",
    "Authorization": authHeader
   }
}

oktaApi.methods.getSingleActiveUser(singleUserArgs, 
  function(data, response) {
    if (response.statusCode == 200) {
        console.log("Getting list of Active Users: \n");
        console.log(response);
        console.log(data);
        //return next();
    } else {
      console.log("Wrong API Token!");
      //return next(new ldap.InvalidCredentialsError());
    }
  }).on('error',function(err) {
      console.log('something went wrong on the request', err.request.options);
      //return next(new ldap.InvalidCredentialsError());
  }); 


server.bind('cn=root', function (req, res, next) {
  // if (req.dn.toString() !== 'cn=root' || req.credentials !== 'secret')
  
  console.log("Binding as: " + req.dn.toString() + " with password: " + req.credentials);

  var creds = {
      headers: { 
        "Accept":"application/json",
        "Content-Type":"application/json",
      },
      data: {
        "username": "administrator1@clouditude.net",
        "password": req.credentials
      }
    };

    console.log(creds);

  oktaApi.methods.createSession(creds, function(data, response) {
    
    if (response.statusCode == 200) {
      console.log("User is authenticated!");
      res.end();
      return next();
    } else {
      console.log("Wrong Creds!");
      return next(new ldap.InvalidCredentialsError());
    }
  }).on('error',function(err) {
      console.log('something went wrong on the request', err.request.options);
      return next(new ldap.InvalidCredentialsError());
  });


});

server.add(SUFFIX, authorize, function (req, res, next) {
  var dn = req.dn.toString();

  if (db[dn])
    return next(new ldap.EntryAlreadyExistsError(dn));

  db[dn] = req.toObject().attributes;
  res.end();
  return next();
});

server.bind(SUFFIX, function (req, res, next) {
  var dn = req.dn.toString();
  if (!db[dn])
    return next(new ldap.NoSuchObjectError(dn));

  if (!db[dn].userpassword)
    return next(new ldap.NoSuchAttributeError('userPassword'));

  if (db[dn].userpassword.indexOf(req.credentials) === -1)
    return next(new ldap.InvalidCredentialsError());

  res.end();
  return next();
});

server.compare(SUFFIX, authorize, function (req, res, next) {
  var dn = req.dn.toString();
  if (!db[dn])
    return next(new ldap.NoSuchObjectError(dn));

  if (!db[dn][req.attribute])
    return next(new ldap.NoSuchAttributeError(req.attribute));

  var matches = false;
  var vals = db[dn][req.attribute];
  for (var i = 0; i < vals.length; i++) {
    if (vals[i] === req.value) {
      matches = true;
      break;
    }
  }

  res.end(matches);
  return next();
});

server.del(SUFFIX, authorize, function (req, res, next) {
  var dn = req.dn.toString();
  if (!db[dn])
    return next(new ldap.NoSuchObjectError(dn));

  delete db[dn];

  res.end();
  return next();
});

server.modify(SUFFIX, authorize, function (req, res, next) {
  var dn = req.dn.toString();
  if (!req.changes.length)
    return next(new ldap.ProtocolError('changes required'));
  if (!db[dn])
    return next(new ldap.NoSuchObjectError(dn));

  var entry = db[dn];

  for (var i = 0; i < req.changes.length; i++) {
    mod = req.changes[i].modification;
    switch (req.changes[i].operation) {
    case 'replace':
      if (!entry[mod.type])
        return next(new ldap.NoSuchAttributeError(mod.type));

      if (!mod.vals || !mod.vals.length) {
        delete entry[mod.type];
      } else {
        entry[mod.type] = mod.vals;
      }

      break;

    case 'add':
      if (!entry[mod.type]) {
        entry[mod.type] = mod.vals;
      } else {
        mod.vals.forEach(function (v) {
          if (entry[mod.type].indexOf(v) === -1)
            entry[mod.type].push(v);
        });
      }

      break;

    case 'delete':
      if (!entry[mod.type])
        return next(new ldap.NoSuchAttributeError(mod.type));

      delete entry[mod.type];

      break;
    }
  }

  res.end();
  return next();
});

server.search(SUFFIX, authorize, function (req, res, next) {
  var dn = req.dn.toString();
  if (!db[dn])
    return next(new ldap.NoSuchObjectError(dn));

  var scopeCheck;

  switch (req.scope) {
  case 'base':
    if (req.filter.matches(db[dn])) {
      res.send({
        dn: dn,
        attributes: db[dn]
      });
    }

    res.end();
    return next();

  case 'one':
    scopeCheck = function (k) {
      if (req.dn.equals(k))
        return true;

      var parent = ldap.parseDN(k).parent();
      return (parent ? parent.equals(req.dn) : false);
    };
    break;

  case 'sub':
    scopeCheck = function (k) {
      return (req.dn.equals(k) || req.dn.parentOf(k));
    };

    break;
  }

  Object.keys(db).forEach(function (key) {
    if (!scopeCheck(key))
      return;

    if (req.filter.matches(db[key])) {
      res.send({
        dn: key,
        attributes: db[key]
      });
    }
  });

  res.end();
  return next();
});



///--- Fire it up

server.listen(1389, function () {
  console.log('LDAP server up at: %s', server.url);
});