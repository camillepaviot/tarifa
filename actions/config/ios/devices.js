var Q = require('q'),
    chalk = require('chalk'),
    spinner = require("char-spinner"),
    ncp = require('ncp').ncp,
    exec = require('child_process').exec,
    path = require('path'),
    format = require('util').format,
    fs = require('fs'),
    tarifaFile = require('../../../lib/tarifa-file'),
    tarifaPath = require('../../../lib/helper/path'),
    print = require('../../../lib/helper/print'),
    parseProvisionFile = require('../../../lib/ios/parse-mobileprovision'),
    downloadProvisioningProfile = require('./provisioning').downloadProvisioningProfile,
    askDeviceName = require('./ask_device_name'),
    askPassword = require('./ask_password');

function getDevices(user, team, password, verbose) {
    var defer = Q.defer(),
        options = {
            timeout : 40000,
            maxBuffer: 1024 * 400
        },
        t = (team ?  (" --team " + team) : ''),
        cmd = "ios devices:list -u " + user + " -p "+ password + t;

    exec(cmd, options, function (err, stdout, stderr) {
        if(err) {
            if(verbose) {
                print.error('command: %s', cmd);
            }
            defer.reject('ios stderr ' + err);
            return;
        }

        var output = stdout.toString().split('\n');
        output = output.slice(5, output.length-2);

        output = output.map(function (line) {
            var r = line.split('|').filter(function (w) {
                return w.length > 0;
            });
            return {
                name: r[0],
                uuid: r[1],
                enabled: r[2].trim() === 'Y'
            }
        });

        defer.resolve(output);
    });

    return defer.promise;
}

function listAction(verbose) {
    return tarifaFile.parseConfig(tarifaPath.current()).then(function (localSettings) {
        if(!localSettings.deploy || !localSettings.delpoy.apple_id)
            return Q.reject("No deploy informations are available in the current tarifa.json file.");
        return askPassword()
            .then(function (password) {
                spinner();
                return getDevices(
                    localSettings.deploy.apple_id,
                    localSettings.deploy.apple_developer_team,
                    password,
                    verbose
                );
            });
    });
}

function usage(msg) {
    print(fs.readFileSync(path.join(__dirname , '..', 'usage.txt'), 'utf-8'));
    return Q.reject(msg);
}

function listDeviceInProvisioningWithInfo(config, verbose) {
    return tarifaFile.parseConfig(path.join(process.cwd(), 'tarifa.json'))
        .then(function (localSettings) {
            if(!localSettings.configurations.ios[config]) {
                return Q.reject('configuration not available!');
            }
            var localConf = localSettings.configurations.ios[config];
            if (!localConf.provisioning_profile_name || !localConf.provisioning_profile_path) {
                return Q.reject('no provisioning profile in configuration!');
            }
            else {
                var provisioning_profile_path = localConf.provisioning_profile_path;
                return parseProvisionFile(provisioning_profile_path).then(function (provision) {
                    var devices = provision.uuids.map(function (uuid){
                        return { name: null, uuid: uuid, enabled: null };
                    });
                    return {
                        type: provision.type,
                        name: provision.name,
                        devices: devices
                    };
                });
            }
        });
}

function printDevices(title, msg) {
    return function (devices) {
        if(title) print(chalk.cyan(title));
        if (devices.length) {
            if(msg) print(msg);
            devices.forEach(function (device) {
                print(
                    "%s %s enabled: %s",
                    chalk.cyan(device.name),
                    chalk.yellow(device.uuid),
                    device.enabled ? chalk.green(device.enabled) : 'false'
                );
            });
        }
    };
}

function list(config, verbose) {
    if(config)
        return listDeviceInProvisioningWithInfo(config, verbose)
            .then(function (provision) {
                var title = format("Provisioning Profile %s with Type: %s", provision.name, provision.type),
                    msg = format("\nDevices in configuration: %s", config);
                printDevices(title, msg)(provision.devices);
            });
    else
        return listAction(verbose).then(printDevices("\nAll Devices :"));
}

function addDevice(user, team, password, name, uuid, verbose) {
    var defer = Q.defer(),
        options = {
            timeout : 40000,
            maxBuffer: 1024 * 400
        },
        t = (team ?  (" --team " + team) : ''),
        cmd = "ios devices:add " + name + "=" + uuid +" -u " + user + " -p "+ password + t;

    exec(cmd, options, function (err, stdout, stderr) {
        if(err) {
            if(verbose) {
                print.error('command: %s', cmd);
            }
            defer.reject('ios stderr ' + err);
            return;
        }

        var output = stdout.toString();
        defer.resolve(output);
    });

    return defer.promise;
}

function add(name, uuid, verbose) {
    return tarifaFile.parseConfig(tarifaPath.current())
        .then(function(localSettings) {
            return askPassword().then(function (password) {
                spinner();
                return addDevice(
                    localSettings.deploy.apple_id,
                    localSettings.deploy.apple_developer_team,
                    password,
                    name,
                    uuid,
                    verbose
                ).then(function (output) { if(verbose) print(output); });
            });
        });
}

function addDeviceToProvisioningProfile(user, team, password, uuid, profile_path, devices, verbose) {
    return parseProvisionFile(profile_path).then(function (provisioning) {
        var defer = Q.defer(),
            options = {
                timeout : 40000,
                maxBuffer: 1024 * 400
            },
            t = (team ?  (" --team " + team) : ''),
            device = devices.filter(function (d) { return d.uuid.trim() === uuid; } )[0],
            deviceTuple = '"' + device.name.trim() + '"=' + uuid,
            cmd = "ios profiles:manage:devices:add " + provisioning.name + " " + deviceTuple + " -u " + user + " -p "+ password + t;

        exec(cmd, options, function (err, stdout, stderr) {
            if(err) {
                if(verbose) {
                    print.error('command: %s', cmd);
                }
                defer.reject('ios stderr ' + err);
                return;
            }

            var output = stdout.toString().split('\n');
            if(verbose) print(output.toString());
            defer.resolve(output.toString());
        });

        return defer.promise;
    });
}

function removeDeviceToProvisioningProfile(user, team, password, uuid, profile_path, devices, verbose) {
    return parseProvisionFile(profile_path).then(function (provisioning) {
        var defer = Q.defer(),
            options = {
                timeout : 40000,
                maxBuffer: 1024 * 400
            },
            t = (team ?  (" --team " + team) : ''),
            device = devices.filter(function (d) { return d.uuid.trim() === uuid; } );

        if(!device[0])  return Q.reject("uuid is not included in the developer center!");

        device = device[0];
        var deviceTuple = '"' + device.name.trim() + '"=' + uuid,
            cmd = "ios profiles:manage:devices:remove " + provisioning.name + " " + deviceTuple + " -u " + user + " -p "+ password + t;
        exec(cmd, options, function (err, stdout, stderr) {
            if(err) {
                if(verbose) {
                    print.error('command: %s', cmd);
                }
                defer.reject('ios stderr ' + err);
                return;
            }

            var output = stdout.toString().split('\n');
            if(verbose) print(output.toString());
            defer.resolve(output.toString());
        });

        return defer.promise;
    });
}

function attach(uuid, config, verbose) {

    return tarifaFile.parseConfig(tarifaPath.current())
        .then(function(localSettings) {
            return askPassword().then(function (password) {
                return getDevices(
                    localSettings.deploy.apple_id,
                    localSettings.deploy.apple_developer_team,
                    password,
                    verbose
                ).then(function (devices) {
                    var rslt =  devices.map(function (device) {
                        return device.uuid.trim();
                    }).filter(function (id) {
                        return id === uuid;
                    });

                    if(rslt.length) {
                        if(verbose) print('device already in developer center');
                        return addDeviceToProvisioningProfile(
                                localSettings.deploy.apple_id,
                                localSettings.deploy.apple_developer_team,
                                password,
                                uuid,
                                localSettings.configurations.ios[config].provisioning_profile_path,
                                devices,
                                verbose
                            ).then(function () {
                            return downloadProvisioningProfile(
                                localSettings.deploy.apple_id,
                                localSettings.deploy.apple_developer_team,
                                password,
                                localSettings.configurations.ios[config].provisioning_profile_name,
                                localSettings.configurations.ios[config].provisioning_profile_path,
                                verbose
                            );
                        });
                    }
                    else {
                        if(verbose) print('device not in developer center');
                        return askDeviceName().then(function (name) {
                            return addDevice(
                                localSettings.deploy.apple_id,
                                localSettings.deploy.apple_developer_team,
                                password,
                                name,
                                uuid,
                                verbose
                            ).then(function (output) {
                                devices.push({
                                    name:name,
                                    uuid:uuid,
                                    enabled:true
                                });
                                if(verbose) print(output);
                            });
                        }).then(function () {
                            return addDeviceToProvisioningProfile(
                                    localSettings.deploy.apple_id,
                                    localSettings.deploy.apple_developer_team,
                                    password,
                                    uuid,
                                    localSettings.configurations.ios[config].provisioning_profile_path,
                                    devices,
                                    verbose
                                ).then(function () {
                                return downloadProvisioningProfile(
                                    localSettings.deploy.apple_id,
                                    localSettings.deploy.apple_developer_team,
                                    password,
                                    localSettings.configurations.ios[config].provisioning_profile_name,
                                    localSettings.configurations.ios[config].provisioning_profile_path,
                                    verbose
                                );
                            });
                        });
                    }
                });
            });
        });
}

function detach(uuid, config, verbose) {

    return tarifaFile.parseConfig(tarifaPath.current())
        .then(function (localSettings) {
            if(!localSettings.configurations.ios[config])
                return Q.reject('configuration not found');
            if(!localSettings.configurations.ios[config].provisioning_profile_path)
                return Q.reject('no provisioning_profile_path attribute in configuration');
            if(!localSettings.configurations.ios[config].provisioning_profile_name)
                return Q.reject('no provisioning_profile_name attribute in configuration');

            return askPassword().then(function (password) {
                return parseProvisionFile(localSettings.configurations.ios[config].provisioning_profile_path)
                    .then(function (provision) {
                        if(provision.uuids.indexOf(uuid) < 0) return Q.reject('device is not included in the provisioning file!');
                        return getDevices(
                            localSettings.deploy.apple_id,
                            localSettings.deploy.apple_developer_team,
                            password,
                            verbose
                        ).then(function (devices) {
                            return removeDeviceToProvisioningProfile(
                                localSettings.deploy.apple_id,
                                localSettings.deploy.apple_developer_team,
                                password,
                                uuid,
                                localSettings.configurations.ios[config].provisioning_profile_path,
                                devices,
                                verbose
                            );
                        });
                    }).then(function () {
                        return downloadProvisioningProfile(
                            localSettings.deploy.apple_id,
                            localSettings.deploy.apple_developer_team,
                            password,
                            localSettings.configurations.ios[config].provisioning_profile_name,
                            localSettings.configurations.ios[config].provisioning_profile_path,
                            verbose
                        );
                    });
            });
        });
}

module.exports = {
    list : list,
    add: add,
    attach: attach,
    detach: detach
};
