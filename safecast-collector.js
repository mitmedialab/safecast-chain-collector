const mqtt = require('mqtt');
const {ChainClient} = require('chainclient');
const SyncQueue = require('./syncqueue');
const units = require('./units');

/**
 * This determines from a metric name whether it's a field we should exclude
 * from posting to Chain.  (Additionally all values that can't be interpreted
 * as a scalar are ignored).
 */
function shouldIgnoreField(key) {
    const ignoreFields = [
        'device_urn',
        /^dev_/,
        /^gateway_/,
        /^service_/,
        'loc_alt',
        'loc_when_motion_began',
        'loc_olc',
        'when_captured'
    ];

    for(let i=0; i<ignoreFields.length; i++) {
        let pattern = ignoreFields[i];
        if(pattern instanceof RegExp && pattern.test(key)) {
            return true;
        } else if(pattern == key) {
            return true;
        }
    }

    return false;
}

class SafecastCollector {
    constructor(config) {
        let self=this;
        self.config = config;
        self.deviceCache = new Map();
        self.chain = new ChainClient(self.config.chainConfig);
        self.queue = new SyncQueue((message) => {
            return self.handleMessage(message);
        });
    }

    async run() {
        let self=this;
        try {
            self.site = await self.chain.get(self.config.chainURL);
            self.devices = await self.site.rel('ch:devices');
        } catch(e) {
            console.log("Error retrieving Chain site: ", e.toString());
        }

        self.mqclient = mqtt.connect(self.config.mqttURL, self.config.mqttConfig);
        self.mqclient.on('connect', () => {
            self.mqclient.subscribe('device/#');
        });

        self.mqclient.on('message', async (topic, message) => {
            self.queue.push(JSON.parse(message.toString()));
        });

    }

    /**
     * Fetch or create (if necessary) the device with the specified name (URN).
     */
    async getDevice(name) {
        let self=this;
        /* check our cache */
        if(self.deviceCache.has(name)) {
            return self.deviceCache.get(name);
        }

        /* iterate over devices on Chain */
        for(let link of self.devices) {
            //console.log(link, link.title, name);
            if(link.title == name) {
                let device = await link.fetch();
                self.deviceCache.set(name, device);
                return device;
            }
        }

        /* create device */
        try {
            let device = await self.devices.create({
                name
            });
            console.log("Created ", name);
            self.deviceCache.set(name, device);
            return device;
        } catch(e) {
            console.log("Failed to create device %s: %s", name, e.toString());
            //console.log(self.devices.items);
        }
    }

    async handleMessage(message) {
        let self=this;
        let deviceURN = message.device_urn;
        let whenCaptured = message.when_captured;

        console.log(deviceURN);

        let device = await self.getDevice(deviceURN);
        if(device === undefined) return;

        // If the device's location has changed, update the geoLocation property
        // on the device (the history of these properties is not stored, but it
        // may be useful to have the current location of the device).  loc_lat
        // and loc_long will also be stored as sensors to keep the location history.
        if(message.loc_lat !== undefined && message.loc_lon !== undefined) {
            let geoLocation = device.prop('geoLocation');
            if(geoLocation === undefined || geoLocation.latitude != message.loc_lat ||
              geoLocation.longitude != message.loc_lon) {
                device.prop('geoLocation', {
                    latitude: message.loc_lat,
                    longitude: message.loc_lon
                });
                await device.save();
            }
        }

        // Iterate over the metrics in the message
        for(let metric in message) {
            if(!message.hasOwnProperty(metric) || shouldIgnoreField(metric)) continue;
            let value = message[metric];
            if(typeof value !== 'number') continue;
            console.log("  - %s: %d", metric, value);

            // Get the collection of sensors associated with this device
            let sensors = await device.rel('ch:sensors');

            // To avoid excessive iteration, stash a Map on the device object
            // where we can keep a cache of metric name->sensor for fast lookups
            if(device.sensorCache === undefined) {
                device.sensorCache = new Map();
            }

            // Check the cache for the sensor
            let sensor = device.sensorCache.get(metric);

            // If we didn't get a sensor, look for it in the collection
            if(sensor === undefined) {
                for(let link of sensors) {
                    if(link.title == metric) {
                        sensor = await link.fetch();
                        break;
                    }
                }
            }

            // If we still don't have a sensor, it needs to be created
            if(sensor === undefined) {
                let unit = units.lookup(metric);
                sensor = await sensors.create({
                    'sensor-type': 'scalar',
                    metric,
                    unit
                });
            }

            // Update the cache with the sensor for this metric
            device.sensorCache.set(metric, sensor);

            // Add the new sample to the dataHistory for this sensor
            let dataHistory = await sensor.rel('ch:dataHistory');
            dataHistory.create({
                timestamp: whenCaptured,
                value
            });
        }
    }
}

const config = require('./config.json');
let collector = new SafecastCollector(config);
collector.run();

