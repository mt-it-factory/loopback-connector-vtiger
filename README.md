# loopback-connector-vtiger

The VTIGER connector enables LoopBack applications to interact with
[VTIGER](https://www.vtiger.com/) tunnel API.

## Installation

In your application root directory, enter:

```shell
$ npm install loopback-connector-vtiger --save
```

This will install the module from npm and add it as a dependency to the application's 
[package.json](http://loopback.io/doc/en/lb2/package.json.html) file.

## Example datasource.json 

A complete example datasource.json:

```javascript
"vtiger": {
  "host": "http://vti.localhost.mc",
  "port": 80,
  "username": "loopback",
  "password": "password",
  "name": "vtiger",
  "connector": "vtiger",
  "crud": false,
  "operations": {},
  "loggerPath" : "server/app/logger.js",
  "countSessionsToInit": 1
}
```

