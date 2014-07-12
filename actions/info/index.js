var Q = require('q'),
    chalk = require('chalk'),
    exec = require('child_process').exec,
    devices = require('../../lib/devices'),
    pkg = require('../../package.json');

module.exports = function (argv) {
        console.log(chalk.green('node version:               ') + process.versions.node);
        console.log(chalk.green('cordova version:            ') + pkg.dependencies.cordova);

    return devices.ios().then(function (devices) {
        console.log(chalk.green('connected iOS devices:      \n\t') +  devices.join('\n\t'));
    }).then(devices.android).then(function (devices) {
        console.log(chalk.green('connected Android devices:') +  devices.join('\n\t'));
    });

    // check installed xcode version if available
    // check android sdk version
    // check if we are in a tarifa project
    return Q.resolve();
};
