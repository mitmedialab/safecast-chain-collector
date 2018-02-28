class UnitLookupTable {
    constructor() {
        let self=this;
        self.units = new Map();
        self.units.set(/^loc_/, 'degrees');
        self.units.set('env_temp', '°C');
        self.units.set('env_humid', 'percent');
        self.units.set('env_press', 'hPa');
        self.units.set('bat_voltage', 'volts');
        self.units.set(/^lnd_/, 'counts/minute');
        self.units.set(/^(pms|opc)[0-9]*_c[0-9]+/, 'counts');
        self.units.set(/^(pms|opc)[0-9]*_(pm|std)/, 'μg/m³');
        self.units.set(/^(pms|opc)[0-9]*_csecs/, 'seconds');
    }

    lookup(metric) {
        let self=this;
        for(let [pattern, unit] of self.units) {
            if(pattern instanceof RegExp && pattern.test(metric)) {
                return unit;
            } else if(pattern == metric) {
                return unit;
            }
        }
        return "unknown";
    }
}

module.exports = new UnitLookupTable();
