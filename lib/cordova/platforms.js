var path = require('path'),
    os = require('os'),
    Q = require('q'),
    chalk = require('chalk'),
    online = require('../helper/online'),
    format = require('util').format,
    cordova_platform_add = require('cordova-lib/src/cordova/platform').add,
    cordova_platform_remove = require('cordova-lib/src/cordova/platform').remove,
    cordova_platform_update = require('cordova-lib/src/cordova/platform').update,
    cordova_util = require('cordova-lib/src/cordova/util'),
    cordova_hooker = require('cordova-lib/src/hooks/HooksRunner'),
    cordova_check = require('./check'),
    version = require('./version'),
    log = require('../helper/log'),
    platformHelper = require('../helper/platform'),
    settings = require('../settings');

function afterPlatformAdd(platforms, root) {
    return Q.all(platforms.map(version.getPlatformVersion(root))).then(function (usedPlatforms) {
        return usedPlatforms.reduce(function (promise, platform) {
            return promise.then(function () {
                var mod = path.resolve(__dirname, '../platforms', platform.name, 'lib/after_platform_add');
                return require(mod)(platform.version, root);
            });
        }, Q());
    });
}

function warnPlatformVersion(platforms) {
    platforms.forEach(function(platform) {
        var v = platformHelper.getVersion(platform),
            name = platformHelper.getName(platform);
        if(v) {
            var pkg = path.join(__dirname, '../platforms', name, 'package.json'),
                versions = require(pkg).versions;
            if (versions === undefined) {
                log.send('error', 'you should upgrade tarifa to > 0.6.0');
            }
            if(versions.indexOf(v) < 0) {
                log.send(
                    'warning',
                    'version %s of platform %s is not supported by tarifa!',
                    v,
                    platform
                );
            }
        }
    });
}

function extendPlatform(platform) {
    if(platform.indexOf('@') > -1) {
        return platform;
    } else {
        var pkg = path.join(__dirname, '../platforms', platform, 'package.json');
        return format('%s@%s', platform, require(pkg).version);
    }
}

function isAvailableOnHostSync(platform) {
    return settings.os_platforms[platform]
        && settings.os_platforms[platform].indexOf(os.platform()) > -1;
}

function addPlatforms (root, platforms) {
    var cwd = process.cwd(),
        appPath = path.resolve(root, settings.cordovaAppPath);

    platforms = platforms.filter(function (platform) {
        return isAvailableOnHostSync(platformHelper.getName(platform));
    });

    process.chdir(appPath);

    var hooks = new cordova_hooker(appPath),
        opts = {
            platforms: platforms,
            spawnoutput: {
                stdio: 'ignore'
            }
        };

    warnPlatformVersion(platforms);

    return cordova_platform_add(hooks, appPath, platforms, opts).then(function () {
        process.chdir(cwd);
    }).then(function () {
        return afterPlatformAdd(platforms, appPath);
    }).then(function () {
        platforms.forEach(function (target) {
            log.send('success', 'platform %s added', target);
        });
        return platforms;
    });
}

function updatePlatforms (root, platforms) {
    var cwd = process.cwd(),
        cordovaRoot = path.resolve(root, settings.cordovaAppPath),
        hooks = new cordova_hooker(cordovaRoot),
        opts = {
            platforms: platforms,
            spawnoutput: {
                stdio: 'ignore'
            }
        };

    warnPlatformVersion(platforms);
    process.chdir(cordovaRoot);

    return cordova_platform_update(hooks, cordovaRoot, platforms, opts).then(function () {
        process.chdir(cwd);
    }).then(function () {
        return afterPlatformAdd(platforms, cordovaRoot);
    }).then(function () { return platforms; });
}

function removePlatforms (root, platforms) {
    var cwd = process.cwd(),
        appRoot = path.resolve(root, settings.cordovaAppPath);

    process.chdir(appRoot);

    var platformNames = platforms.map(platformHelper.getName),
        hooks = new cordova_hooker(appRoot),
        opts = {
            platforms: platforms,
            spawnoutput: {
                stdio: 'ignore'
            }
        };

    return cordova_platform_remove(hooks, appRoot, platformNames, opts)
        .then(function () {
            process.chdir(cwd);
            platformNames.forEach(function (target) {
                log.send('success', 'cordova platform %s removed', target);
            });
            return platforms;
        });
}

function listPlatforms(root) {
    var cwd = process.cwd(),
        appRoot = path.resolve(root, settings.cordovaAppPath);

    process.chdir(appRoot);

    var platforms_on_fs = cordova_util.listPlatforms(appRoot);

    return Q.resolve(platforms_on_fs).then(function(platforms) {
        log.send('msg', chalk.green(platforms.join('\n')));
        process.chdir(cwd);
        return platforms;
    });
}

function isAvailableOnHost(platform) {
    if(!settings.os_platforms[platform])
        return Q.reject('platform name does not exist');
    return isAvailableOnHostSync(platform)
        ? Q.resolve(true)
        : Q.reject('platform not available on your os');
}

function installedPlatforms(names) {
    var platforms = (names || settings.platforms).filter(isAvailableOnHostSync),
        onlineDefer = Q.defer(),
        mapping = function (p) { return { name: p, value: p }; };

    return online({
        skip: true,
        msg: 'internet unavailable skipping platform check!'
    }).then(function (online) {
        if(!online) return platforms.map(mapping);

        return platforms.reduce(function (rslt, item) {
            return Q.when(rslt, function (r) {
                return cordova_check(item).then(function () {
                    r.push(mapping(item));
                    return r;
                }, function (err) {
                    log.send('error', 'platform %s %s', item, err.toString());
                    r.push({ name: item, value: item, disabled: true });
                    return r;
                });
            });
        }, []);
    });
}

function listShouldBeAvailableOnHost() {
    var host = os.platform(), r = [];
    for(var p in settings.os_platforms) {
        if(settings.os_platforms[p].indexOf(host) > -1) r.push(p);
    }
    return r;
}

function listAvailableOnHost(names) {
    return installedPlatforms(names).then(function (platforms) {
        return platforms.filter(function (p) { return !p.disabled; });
    }).then(function (availables) {
        return availables.map(function (p) { return p.name; });
    });
}

function info() {
    return settings.platforms.map(function (platform) {
        return require(path.resolve(
            __dirname,
            '../platforms',
            platform,
            'package.json'
        ));
    });
}

module.exports = {
    add: addPlatforms,
    remove: removePlatforms,
    update: updatePlatforms,
    list: listPlatforms,
    isAvailableOnHost: isAvailableOnHost,
    isAvailableOnHostSync: isAvailableOnHostSync,
    installedPlatforms: installedPlatforms,
    listAvailableOnHost: listAvailableOnHost,
    extendPlatform: extendPlatform,
    info: info,
    listShouldBeAvailableOnHost: listShouldBeAvailableOnHost
};
