var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/.pnpm/ipaddr.js@2.5.0/node_modules/ipaddr.js/lib/ipaddr.js
var require_ipaddr = __commonJS({
  "node_modules/.pnpm/ipaddr.js@2.5.0/node_modules/ipaddr.js/lib/ipaddr.js"(exports, module) {
    (function(root) {
      "use strict";
      const ipv4Part = "(0?\\d+|0x[a-f0-9]+)";
      const ipv4Regexes = {
        fourOctet: new RegExp(`^${ipv4Part}\\.${ipv4Part}\\.${ipv4Part}\\.${ipv4Part}$`, "i"),
        threeOctet: new RegExp(`^${ipv4Part}\\.${ipv4Part}\\.${ipv4Part}$`, "i"),
        twoOctet: new RegExp(`^${ipv4Part}\\.${ipv4Part}$`, "i"),
        longValue: new RegExp(`^${ipv4Part}$`, "i")
      };
      const octalRegex = new RegExp(`^0[0-7]+$`, "i");
      const hexRegex = new RegExp(`^0x[a-f0-9]+$`, "i");
      const zoneIndex = "%[0-9a-z]{1,}";
      const ipv6Part = "(?:[0-9a-f]+::?)+";
      const ipv6Regexes = {
        zoneIndex: new RegExp(zoneIndex, "i"),
        "native": new RegExp(`^(::)?(${ipv6Part})?([0-9a-f]+)?(::)?(${zoneIndex})?$`, "i"),
        deprecatedTransitional: new RegExp(`^(?:::)(${ipv4Part}\\.${ipv4Part}\\.${ipv4Part}\\.${ipv4Part}(${zoneIndex})?)$`, "i"),
        transitional: new RegExp(`^((?:${ipv6Part})|(?:::)(?:${ipv6Part})?)${ipv4Part}\\.${ipv4Part}\\.${ipv4Part}\\.${ipv4Part}(${zoneIndex})?$`, "i")
      };
      function expandIPv6(string, parts) {
        if (string.indexOf("::") !== string.lastIndexOf("::")) {
          return null;
        }
        let colonCount = 0;
        let lastColon = -1;
        let zoneId = (string.match(ipv6Regexes.zoneIndex) || [])[0];
        let replacement, replacementCount;
        if (zoneId) {
          zoneId = zoneId.substring(1);
          string = string.replace(/%.+$/, "");
        }
        while ((lastColon = string.indexOf(":", lastColon + 1)) >= 0) {
          colonCount++;
        }
        if (string.substr(0, 2) === "::") {
          colonCount--;
        }
        if (string.substr(-2, 2) === "::") {
          colonCount--;
        }
        if (colonCount >= parts) {
          return null;
        }
        replacementCount = parts - colonCount;
        replacement = ":";
        while (replacementCount--) {
          replacement += "0:";
        }
        string = string.replace("::", replacement);
        if (string[0] === ":") {
          string = string.slice(1);
        }
        if (string[string.length - 1] === ":") {
          string = string.slice(0, -1);
        }
        parts = (function() {
          const ref = string.split(":");
          const results = [];
          for (let i = 0; i < ref.length; i++) {
            results.push(ref[i].length > 4 ? NaN : parseInt(ref[i], 16));
          }
          return results;
        })();
        return {
          parts,
          zoneId
        };
      }
      function matchCIDR(first, second, partSize, cidrBits) {
        if (first.length !== second.length) {
          throw new Error("ipaddr: cannot match CIDR for objects with different lengths");
        }
        let part = 0;
        let shift;
        while (cidrBits > 0) {
          shift = partSize - cidrBits;
          if (shift < 0) {
            shift = 0;
          }
          if (first[part] >> shift !== second[part] >> shift) {
            return false;
          }
          cidrBits -= partSize;
          part += 1;
        }
        return true;
      }
      function parseIntAuto(string) {
        if (hexRegex.test(string)) {
          return parseInt(string, 16);
        }
        if (string[0] === "0" && !isNaN(parseInt(string[1], 10))) {
          if (octalRegex.test(string)) {
            return parseInt(string, 8);
          }
          throw new Error(`ipaddr: cannot parse ${string} as octal`);
        }
        return parseInt(string, 10);
      }
      function padPart(part, length) {
        while (part.length < length) {
          part = `0${part}`;
        }
        return part;
      }
      const ipaddr2 = {};
      ipaddr2.IPv4 = (function() {
        function IPv4(octets) {
          if (octets.length !== 4) {
            throw new Error("ipaddr: ipv4 octet count should be 4");
          }
          let i, octet;
          for (i = 0; i < octets.length; i++) {
            octet = octets[i];
            if (!(0 <= octet && octet <= 255)) {
              throw new Error("ipaddr: ipv4 octet should fit in 8 bits");
            }
          }
          this.octets = octets;
        }
        IPv4.prototype.SpecialRanges = {
          unspecified: [[new IPv4([0, 0, 0, 0]), 8]],
          broadcast: [[new IPv4([255, 255, 255, 255]), 32]],
          // RFC3171
          multicast: [[new IPv4([224, 0, 0, 0]), 4]],
          // RFC3927
          linkLocal: [[new IPv4([169, 254, 0, 0]), 16]],
          // RFC5735
          loopback: [[new IPv4([127, 0, 0, 0]), 8]],
          // RFC6598
          carrierGradeNat: [[new IPv4([100, 64, 0, 0]), 10]],
          // RFC1918
          "private": [
            [new IPv4([10, 0, 0, 0]), 8],
            [new IPv4([172, 16, 0, 0]), 12],
            [new IPv4([192, 168, 0, 0]), 16]
          ],
          // Reserved and testing-only ranges; RFCs 5735, 5737, 2544, 1700
          reserved: [
            [new IPv4([192, 0, 0, 0]), 24],
            [new IPv4([192, 0, 2, 0]), 24],
            [new IPv4([192, 88, 99, 0]), 24],
            [new IPv4([198, 18, 0, 0]), 15],
            [new IPv4([198, 51, 100, 0]), 24],
            [new IPv4([203, 0, 113, 0]), 24],
            [new IPv4([240, 0, 0, 0]), 4]
          ],
          // RFC7534, RFC7535
          as112: [
            [new IPv4([192, 175, 48, 0]), 24],
            [new IPv4([192, 31, 196, 0]), 24]
          ],
          // RFC7450
          amt: [
            [new IPv4([192, 52, 193, 0]), 24]
          ]
        };
        IPv4.prototype.kind = function() {
          return "ipv4";
        };
        IPv4.prototype.match = function(other, cidrRange) {
          let ref;
          if (cidrRange === void 0) {
            ref = other;
            other = ref[0];
            cidrRange = ref[1];
          }
          if (other.kind() !== "ipv4") {
            throw new Error("ipaddr: cannot match ipv4 address with non-ipv4 one");
          }
          return matchCIDR(this.octets, other.octets, 8, cidrRange);
        };
        IPv4.prototype.prefixLengthFromSubnetMask = function() {
          let cidr = 0;
          let stop = false;
          const zerotable = {
            0: 8,
            128: 7,
            192: 6,
            224: 5,
            240: 4,
            248: 3,
            252: 2,
            254: 1,
            255: 0
          };
          let i, octet, zeros;
          for (i = 3; i >= 0; i -= 1) {
            octet = this.octets[i];
            if (octet in zerotable) {
              zeros = zerotable[octet];
              if (stop && zeros !== 0) {
                return null;
              }
              if (zeros !== 8) {
                stop = true;
              }
              cidr += zeros;
            } else {
              return null;
            }
          }
          return 32 - cidr;
        };
        IPv4.prototype.range = function() {
          return ipaddr2.subnetMatch(this, this.SpecialRanges);
        };
        IPv4.prototype.toByteArray = function() {
          return this.octets.slice(0);
        };
        IPv4.prototype.toIPv4MappedAddress = function() {
          return ipaddr2.IPv6.parse(`::ffff:${this.toString()}`);
        };
        IPv4.prototype.toNormalizedString = function() {
          return this.toString();
        };
        IPv4.prototype.toString = function() {
          return this.octets.join(".");
        };
        return IPv4;
      })();
      ipaddr2.IPv4.broadcastAddressFromCIDR = function(string) {
        try {
          const cidr = this.parseCIDR(string);
          const ipInterfaceOctets = cidr[0].toByteArray();
          const subnetMaskOctets = this.subnetMaskFromPrefixLength(cidr[1]).toByteArray();
          const octets = [];
          let i = 0;
          while (i < 4) {
            octets.push(parseInt(ipInterfaceOctets[i], 10) | parseInt(subnetMaskOctets[i], 10) ^ 255);
            i++;
          }
          return new this(octets);
        } catch (e) {
          throw new Error("ipaddr: the address does not have IPv4 CIDR format", { cause: e });
        }
      };
      ipaddr2.IPv4.isIPv4 = function(string) {
        return this.parser(string) !== null;
      };
      ipaddr2.IPv4.isValid = function(string) {
        try {
          new this(this.parser(string));
          return true;
        } catch {
          return false;
        }
      };
      ipaddr2.IPv4.isValidCIDR = function(string) {
        try {
          this.parseCIDR(string);
          return true;
        } catch {
          return false;
        }
      };
      ipaddr2.IPv4.isValidFourPartDecimal = function(string) {
        if (ipaddr2.IPv4.isValid(string) && string.match(/^(0|[1-9]\d*)(\.(0|[1-9]\d*)){3}$/)) {
          return true;
        } else {
          return false;
        }
      };
      ipaddr2.IPv4.isValidCIDRFourPartDecimal = function(string) {
        const match = string.match(/^(.+)\/(\d+)$/);
        if (!ipaddr2.IPv4.isValidCIDR(string) || !match) {
          return false;
        }
        return ipaddr2.IPv4.isValidFourPartDecimal(match[1]);
      };
      ipaddr2.IPv4.networkAddressFromCIDR = function(string) {
        let cidr, i, ipInterfaceOctets, octets, subnetMaskOctets;
        try {
          cidr = this.parseCIDR(string);
          ipInterfaceOctets = cidr[0].toByteArray();
          subnetMaskOctets = this.subnetMaskFromPrefixLength(cidr[1]).toByteArray();
          octets = [];
          i = 0;
          while (i < 4) {
            octets.push(parseInt(ipInterfaceOctets[i], 10) & parseInt(subnetMaskOctets[i], 10));
            i++;
          }
          return new this(octets);
        } catch (e) {
          throw new Error("ipaddr: the address does not have IPv4 CIDR format", { cause: e });
        }
      };
      ipaddr2.IPv4.parse = function(string) {
        const parts = this.parser(string);
        if (parts === null) {
          throw new Error("ipaddr: string is not formatted like an IPv4 Address");
        }
        return new this(parts);
      };
      ipaddr2.IPv4.parseCIDR = function(string) {
        let match;
        if (match = string.match(/^(.+)\/(\d+)$/)) {
          const maskLength = parseInt(match[2]);
          if (maskLength >= 0 && maskLength <= 32) {
            const parsed = [this.parse(match[1]), maskLength];
            Object.defineProperty(parsed, "toString", {
              value: function() {
                return this.join("/");
              }
            });
            return parsed;
          }
        }
        throw new Error("ipaddr: string is not formatted like an IPv4 CIDR range");
      };
      ipaddr2.IPv4.parser = function(string) {
        let match, part, value;
        if (match = string.match(ipv4Regexes.fourOctet)) {
          return (function() {
            const ref = match.slice(1, 6);
            const results = [];
            for (let i = 0; i < ref.length; i++) {
              part = ref[i];
              results.push(parseIntAuto(part));
            }
            return results;
          })();
        } else if (match = string.match(ipv4Regexes.longValue)) {
          value = parseIntAuto(match[1]);
          if (value > 4294967295 || value < 0) {
            throw new Error("ipaddr: address outside defined range");
          }
          return (function() {
            const results = [];
            let shift;
            for (shift = 0; shift <= 24; shift += 8) {
              results.push(value >> shift & 255);
            }
            return results;
          })().reverse();
        } else if (match = string.match(ipv4Regexes.twoOctet)) {
          return (function() {
            const ref = match.slice(1, 4);
            const results = [];
            value = parseIntAuto(ref[1]);
            if (value > 16777215 || value < 0) {
              throw new Error("ipaddr: address outside defined range");
            }
            results.push(parseIntAuto(ref[0]));
            results.push(value >> 16 & 255);
            results.push(value >> 8 & 255);
            results.push(value & 255);
            return results;
          })();
        } else if (match = string.match(ipv4Regexes.threeOctet)) {
          return (function() {
            const ref = match.slice(1, 5);
            const results = [];
            value = parseIntAuto(ref[2]);
            if (value > 65535 || value < 0) {
              throw new Error("ipaddr: address outside defined range");
            }
            results.push(parseIntAuto(ref[0]));
            results.push(parseIntAuto(ref[1]));
            results.push(value >> 8 & 255);
            results.push(value & 255);
            return results;
          })();
        } else {
          return null;
        }
      };
      ipaddr2.IPv4.subnetMaskFromPrefixLength = function(prefix) {
        prefix = parseInt(prefix);
        if (Number.isNaN(prefix) || prefix < 0 || prefix > 32) {
          throw new Error("ipaddr: invalid IPv4 prefix length");
        }
        const octets = [0, 0, 0, 0];
        let j = 0;
        const filledOctetCount = Math.floor(prefix / 8);
        while (j < filledOctetCount) {
          octets[j] = 255;
          j++;
        }
        if (filledOctetCount < 4) {
          octets[filledOctetCount] = Math.pow(2, prefix % 8) - 1 << 8 - prefix % 8;
        }
        return new this(octets);
      };
      ipaddr2.IPv6 = (function() {
        function IPv6(parts, zoneId) {
          let i, part;
          if (parts.length === 16) {
            this.parts = [];
            for (i = 0; i <= 14; i += 2) {
              this.parts.push(parts[i] << 8 | parts[i + 1]);
            }
          } else if (parts.length === 8) {
            this.parts = parts;
          } else {
            throw new Error("ipaddr: ipv6 part count should be 8 or 16");
          }
          for (i = 0; i < this.parts.length; i++) {
            part = this.parts[i];
            if (!(0 <= part && part <= 65535)) {
              throw new Error("ipaddr: ipv6 part should fit in 16 bits");
            }
          }
          if (zoneId) {
            this.zoneId = zoneId;
          }
        }
        IPv6.prototype.SpecialRanges = {
          // RFC4291, here and after
          unspecified: [new IPv6([0, 0, 0, 0, 0, 0, 0, 0]), 128],
          linkLocal: [new IPv6([65152, 0, 0, 0, 0, 0, 0, 0]), 10],
          multicast: [new IPv6([65280, 0, 0, 0, 0, 0, 0, 0]), 8],
          loopback: [new IPv6([0, 0, 0, 0, 0, 0, 0, 1]), 128],
          uniqueLocal: [new IPv6([64512, 0, 0, 0, 0, 0, 0, 0]), 7],
          ipv4Mapped: [new IPv6([0, 0, 0, 0, 0, 65535, 0, 0]), 96],
          // RFC3879
          deprecatedSiteLocal: [new IPv6([65216, 0, 0, 0, 0, 0, 0, 0]), 10],
          // RFC6666
          discard: [new IPv6([256, 0, 0, 0, 0, 0, 0, 0]), 64],
          // RFC6145
          rfc6145: [new IPv6([0, 0, 0, 0, 65535, 0, 0, 0]), 96],
          rfc6052: [
            // RFC6052
            [new IPv6([100, 65435, 0, 0, 0, 0, 0, 0]), 96],
            // RFC8215
            [new IPv6([100, 65435, 1, 0, 0, 0, 0, 0]), 48]
          ],
          // RFC3056
          "6to4": [new IPv6([8194, 0, 0, 0, 0, 0, 0, 0]), 16],
          // RFC6052, RFC6146
          teredo: [new IPv6([8193, 0, 0, 0, 0, 0, 0, 0]), 32],
          // RFC5180
          benchmarking: [new IPv6([8193, 2, 0, 0, 0, 0, 0, 0]), 48],
          // RFC7450
          amt: [new IPv6([8193, 3, 0, 0, 0, 0, 0, 0]), 32],
          as112v6: [
            // RFC7535
            [new IPv6([8193, 4, 274, 0, 0, 0, 0, 0]), 48],
            // RFC7534
            [new IPv6([9760, 79, 32768, 0, 0, 0, 0, 0]), 48]
          ],
          // RFC4843
          deprecatedOrchid: [new IPv6([8193, 16, 0, 0, 0, 0, 0, 0]), 28],
          // RFC7343
          orchid2: [new IPv6([8193, 32, 0, 0, 0, 0, 0, 0]), 28],
          // RFC9374
          droneRemoteIdProtocolEntityTags: [new IPv6([8193, 48, 0, 0, 0, 0, 0, 0]), 28],
          // RFC9602
          segmentRouting: [new IPv6([24320, 0, 0, 0, 0, 0, 0, 0]), 16],
          reserved: [
            // RFC3849
            [new IPv6([8193, 0, 0, 0, 0, 0, 0, 0]), 23],
            // RFC2928
            [new IPv6([8193, 3512, 0, 0, 0, 0, 0, 0]), 32],
            // RFC9637
            [new IPv6([16383, 0, 0, 0, 0, 0, 0, 0]), 20]
          ]
        };
        IPv6.prototype.isIPv4MappedAddress = function() {
          return this.range() === "ipv4Mapped";
        };
        IPv6.prototype.kind = function() {
          return "ipv6";
        };
        IPv6.prototype.match = function(other, cidrRange) {
          let ref;
          if (cidrRange === void 0) {
            ref = other;
            other = ref[0];
            cidrRange = ref[1];
          }
          if (other.kind() !== "ipv6") {
            throw new Error("ipaddr: cannot match ipv6 address with non-ipv6 one");
          }
          return matchCIDR(this.parts, other.parts, 16, cidrRange);
        };
        IPv6.prototype.prefixLengthFromSubnetMask = function() {
          let cidr = 0;
          let stop = false;
          const zerotable = {
            0: 16,
            32768: 15,
            49152: 14,
            57344: 13,
            61440: 12,
            63488: 11,
            64512: 10,
            65024: 9,
            65280: 8,
            65408: 7,
            65472: 6,
            65504: 5,
            65520: 4,
            65528: 3,
            65532: 2,
            65534: 1,
            65535: 0
          };
          let part, zeros;
          for (let i = 7; i >= 0; i -= 1) {
            part = this.parts[i];
            if (part in zerotable) {
              zeros = zerotable[part];
              if (stop && zeros !== 0) {
                return null;
              }
              if (zeros !== 16) {
                stop = true;
              }
              cidr += zeros;
            } else {
              return null;
            }
          }
          return 128 - cidr;
        };
        IPv6.prototype.range = function() {
          return ipaddr2.subnetMatch(this, this.SpecialRanges);
        };
        IPv6.prototype.toByteArray = function() {
          let part;
          const bytes = [];
          const ref = this.parts;
          for (let i = 0; i < ref.length; i++) {
            part = ref[i];
            bytes.push(part >> 8);
            bytes.push(part & 255);
          }
          return bytes;
        };
        IPv6.prototype.toFixedLengthString = function() {
          const addr = (function() {
            const results = [];
            for (let i = 0; i < this.parts.length; i++) {
              results.push(padPart(this.parts[i].toString(16), 4));
            }
            return results;
          }).call(this).join(":");
          let suffix = "";
          if (this.zoneId) {
            suffix = `%${this.zoneId}`;
          }
          return addr + suffix;
        };
        IPv6.prototype.toIPv4Address = function() {
          if (!this.isIPv4MappedAddress()) {
            throw new Error("ipaddr: trying to convert a generic ipv6 address to ipv4");
          }
          const ref = this.parts.slice(-2);
          const high = ref[0];
          const low = ref[1];
          return new ipaddr2.IPv4([high >> 8, high & 255, low >> 8, low & 255]);
        };
        IPv6.prototype.toNormalizedString = function() {
          const addr = (function() {
            const results = [];
            for (let i = 0; i < this.parts.length; i++) {
              results.push(this.parts[i].toString(16));
            }
            return results;
          }).call(this).join(":");
          let suffix = "";
          if (this.zoneId) {
            suffix = `%${this.zoneId}`;
          }
          return addr + suffix;
        };
        IPv6.prototype.toRFC5952String = function() {
          const regex = /((^|:)(0(:|$)){2,})/g;
          let suffix = "";
          if (this.zoneId) {
            suffix = `%${this.zoneId}`;
          }
          const normalized = this.toNormalizedString();
          const string = normalized.slice(0, normalized.length - suffix.length);
          let bestMatchIndex = 0;
          let bestMatchLength = -1;
          let bestMatchGroups = -1;
          let match;
          while (match = regex.exec(string)) {
            const groups = (match[0].match(/0/g) || []).length;
            if (groups > bestMatchGroups) {
              bestMatchGroups = groups;
              bestMatchIndex = match.index;
              bestMatchLength = match[0].length;
            }
          }
          if (bestMatchLength < 0) {
            return string + suffix;
          }
          return `${string.substring(0, bestMatchIndex)}::${string.substring(bestMatchIndex + bestMatchLength)}${suffix}`;
        };
        IPv6.prototype.toString = function() {
          return this.toRFC5952String();
        };
        return IPv6;
      })();
      ipaddr2.IPv6.broadcastAddressFromCIDR = function(string) {
        try {
          const cidr = this.parseCIDR(string);
          const ipInterfaceOctets = cidr[0].toByteArray();
          const subnetMaskOctets = this.subnetMaskFromPrefixLength(cidr[1]).toByteArray();
          const octets = [];
          let i = 0;
          while (i < 16) {
            octets.push(parseInt(ipInterfaceOctets[i], 10) | parseInt(subnetMaskOctets[i], 10) ^ 255);
            i++;
          }
          return new this(octets);
        } catch (e) {
          throw new Error("ipaddr: the address does not have IPv6 CIDR format", { cause: e });
        }
      };
      ipaddr2.IPv6.isIPv6 = function(string) {
        return this.parser(string) !== null;
      };
      ipaddr2.IPv6.isValid = function(string) {
        if (typeof string === "string" && string.indexOf(":") === -1) {
          return false;
        }
        try {
          const addr = this.parser(string);
          new this(addr.parts, addr.zoneId);
          return true;
        } catch {
          return false;
        }
      };
      ipaddr2.IPv6.isValidCIDR = function(string) {
        if (typeof string === "string" && string.indexOf(":") === -1) {
          return false;
        }
        try {
          this.parseCIDR(string);
          return true;
        } catch {
          return false;
        }
      };
      ipaddr2.IPv6.networkAddressFromCIDR = function(string) {
        let cidr, i, ipInterfaceOctets, octets, subnetMaskOctets;
        try {
          cidr = this.parseCIDR(string);
          ipInterfaceOctets = cidr[0].toByteArray();
          subnetMaskOctets = this.subnetMaskFromPrefixLength(cidr[1]).toByteArray();
          octets = [];
          i = 0;
          while (i < 16) {
            octets.push(parseInt(ipInterfaceOctets[i], 10) & parseInt(subnetMaskOctets[i], 10));
            i++;
          }
          return new this(octets);
        } catch (e) {
          throw new Error("ipaddr: the address does not have IPv6 CIDR format", { cause: e });
        }
      };
      ipaddr2.IPv6.parse = function(string) {
        const addr = this.parser(string);
        if (addr === null) {
          throw new Error("ipaddr: string is not formatted like an IPv6 Address");
        }
        return new this(addr.parts, addr.zoneId);
      };
      ipaddr2.IPv6.parseCIDR = function(string) {
        let maskLength, match, parsed;
        if (match = string.match(/^(.+)\/(\d+)$/)) {
          maskLength = parseInt(match[2]);
          if (maskLength >= 0 && maskLength <= 128) {
            parsed = [this.parse(match[1]), maskLength];
            Object.defineProperty(parsed, "toString", {
              value: function() {
                return this.join("/");
              }
            });
            return parsed;
          }
        }
        throw new Error("ipaddr: string is not formatted like an IPv6 CIDR range");
      };
      ipaddr2.IPv6.parser = function(string) {
        let addr, i, match, octet, octets, zoneId;
        if (match = string.match(ipv6Regexes.deprecatedTransitional)) {
          return this.parser(`::ffff:${match[1]}`);
        }
        if (ipv6Regexes.native.test(string)) {
          return expandIPv6(string, 8);
        }
        if (match = string.match(ipv6Regexes.transitional)) {
          zoneId = match[6] || "";
          addr = match[1];
          if (!match[1].endsWith("::")) {
            addr = addr.slice(0, -1);
          }
          addr = expandIPv6(addr + zoneId, 6);
          if (addr && addr.parts) {
            octets = [
              parseInt(match[2]),
              parseInt(match[3]),
              parseInt(match[4]),
              parseInt(match[5])
            ];
            for (i = 0; i < octets.length; i++) {
              octet = octets[i];
              if (!(0 <= octet && octet <= 255)) {
                return null;
              }
            }
            addr.parts.push(octets[0] << 8 | octets[1]);
            addr.parts.push(octets[2] << 8 | octets[3]);
            return {
              parts: addr.parts,
              zoneId: addr.zoneId
            };
          }
        }
        return null;
      };
      ipaddr2.IPv6.subnetMaskFromPrefixLength = function(prefix) {
        prefix = parseInt(prefix);
        if (Number.isNaN(prefix) || prefix < 0 || prefix > 128) {
          throw new Error("ipaddr: invalid IPv6 prefix length");
        }
        const octets = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        let j = 0;
        const filledOctetCount = Math.floor(prefix / 8);
        while (j < filledOctetCount) {
          octets[j] = 255;
          j++;
        }
        if (filledOctetCount < 16) {
          octets[filledOctetCount] = Math.pow(2, prefix % 8) - 1 << 8 - prefix % 8;
        }
        return new this(octets);
      };
      ipaddr2.fromByteArray = function(bytes) {
        const length = bytes.length;
        if (length === 4) {
          return new ipaddr2.IPv4(bytes);
        } else if (length === 16) {
          return new ipaddr2.IPv6(bytes);
        } else {
          throw new Error("ipaddr: the binary input is neither an IPv6 nor IPv4 address");
        }
      };
      ipaddr2.isValid = function(string) {
        return ipaddr2.IPv6.isValid(string) || ipaddr2.IPv4.isValid(string);
      };
      ipaddr2.isValidCIDR = function(string) {
        return ipaddr2.IPv6.isValidCIDR(string) || ipaddr2.IPv4.isValidCIDR(string);
      };
      ipaddr2.parse = function(string) {
        if (ipaddr2.IPv6.isValid(string)) {
          return ipaddr2.IPv6.parse(string);
        } else if (ipaddr2.IPv4.isValid(string)) {
          return ipaddr2.IPv4.parse(string);
        } else {
          throw new Error("ipaddr: the address has neither IPv6 nor IPv4 format");
        }
      };
      ipaddr2.parseCIDR = function(string) {
        try {
          return ipaddr2.IPv6.parseCIDR(string);
        } catch {
          try {
            return ipaddr2.IPv4.parseCIDR(string);
          } catch (e) {
            throw new Error("ipaddr: the address has neither IPv6 nor IPv4 CIDR format", { cause: e });
          }
        }
      };
      ipaddr2.process = function(string) {
        const addr = this.parse(string);
        if (addr.kind() === "ipv6" && addr.isIPv4MappedAddress()) {
          return addr.toIPv4Address();
        } else {
          return addr;
        }
      };
      ipaddr2.subnetMatch = function(address, rangeList, defaultName) {
        let i, rangeName, rangeSubnets, subnet;
        if (defaultName === void 0 || defaultName === null) {
          defaultName = "unicast";
        }
        for (rangeName in rangeList) {
          if (Object.prototype.hasOwnProperty.call(rangeList, rangeName)) {
            rangeSubnets = rangeList[rangeName];
            if (rangeSubnets[0] && !(rangeSubnets[0] instanceof Array)) {
              rangeSubnets = [rangeSubnets];
            }
            for (i = 0; i < rangeSubnets.length; i++) {
              subnet = rangeSubnets[i];
              if (address.kind() === subnet[0].kind() && address.match.apply(address, subnet)) {
                return rangeName;
              }
            }
          }
        }
        return defaultName;
      };
      if (typeof module !== "undefined" && module.exports) {
        module.exports = ipaddr2;
      } else {
        root.ipaddr = ipaddr2;
      }
    })(exports);
  }
});

// src/address-ranges.ts
var import_ipaddr = __toESM(require_ipaddr(), 1);

// src/config.ts
var SURFING_MICROLINK_SECRET = "CORTICO_SURFING_MICROLINK_API_KEY";
var PROXY_MODE_PATH = "worlds.surfing.network.proxyCompatibility";
var PROXY_RANGES_PATH = "worlds.surfing.network.customProxyRanges";
var SURFING_DEFAULTS = {
  enabled: false,
  reading: { maxResponseEstimatedTokens: 3e3, maxSourceChars: 3e5 },
  bili: { subtitleGroupSec: 30, maxSubtitleRetries: 2, subtitleRetryDelayMs: 1e3 },
  network: { maxDownloadBytes: 8 * 1024 * 1024, requestTimeoutMs: 2e4, proxyCompatibility: false, customProxyRanges: "" },
  cache: { ttlMs: 9e5, maxBytes: 32 * 1024 * 1024 },
  search: { bili: true, tieba: true, moegirl: true, baike: true, maxResults: 5 }
};
var SURFING_CONFIG_GROUP = {
  id: "world:surfing",
  owner: "world:surfing",
  schema: { type: "object", title: "\u9605\u8BFB\u4E0E\u5B57\u5E55", properties: {
    "worlds.surfing.reading.maxResponseEstimatedTokens": {
      type: "integer",
      title: "\u5355\u6B21\u8FD4\u56DE\u4E0A\u9650",
      minimum: 1024,
      maximum: 32768,
      "x-suffix": "\u4F30\u7B97 token",
      "x-hot": true,
      description: "\u5305\u542B\u6B63\u6587\u548C\u7EED\u8BFB\u4FE1\u606F\uFF1B\u4E0B\u6B21\u8C03\u7528\u751F\u6548\u3002\u8FDE\u7EED\u7EED\u8BFB\u4F1A\u7D2F\u79EF\u4E0A\u4E0B\u6587\u3002"
    },
    "worlds.surfing.bili.subtitleGroupSec": {
      type: "integer",
      title: "\u5B57\u5E55\u65F6\u95F4\u5206\u7EC4",
      minimum: 1,
      maximum: 120,
      "x-suffix": "\u79D2",
      "x-hot": true,
      description: "\u5408\u5E76\u663E\u793A\u65F6\u95F4\u6233\uFF0C\u4FDD\u7559\u539F\u53E5\uFF1B\u65B0\u8BFB\u53D6\u751F\u6548\u3002"
    },
    "worlds.surfing.bili.maxSubtitleRetries": {
      type: "integer",
      title: "\u7A7A\u5B57\u5E55\u91CD\u8BD5\u6B21\u6570",
      minimum: 0,
      maximum: 5,
      "x-suffix": "\u6B21",
      "x-hot": true,
      description: "\u9996\u6B21\u4E3A\u7A7A\u540E\u989D\u5916\u91CD\u8BD5\uFF1B0 \u8868\u793A\u5173\u95ED\u3002\u65B0\u8BFB\u53D6\u751F\u6548\u3002"
    },
    "worlds.surfing.bili.subtitleRetryDelayMs": {
      type: "integer",
      title: "\u9996\u6B21\u91CD\u8BD5\u7B49\u5F85",
      minimum: 100,
      maximum: 1e4,
      "x-scale": 1e3,
      "x-suffix": "\u79D2",
      "x-hot": true,
      description: "\u540E\u7EED\u6BCF\u6B21\u7B49\u5F85\u7FFB\u500D\uFF0C\u91CD\u8BD5\u5171\u7528\u5355\u6B21\u8BFB\u53D6\u8D85\u65F6\u3002\u65B0\u8BFB\u53D6\u751F\u6548\u3002"
    }
  } }
};
var SURFING_SEARCH_CONFIG_GROUP = {
  id: "world:surfing:search",
  owner: "world:surfing",
  schema: { type: "object", title: "\u7AD9\u70B9\u641C\u7D22", description: "\u7528\u4E8E surfing_search_all \u53CA\u5176\u8D34\u5427\u7EED\u641C\uFF0C\u4E0B\u6B21\u8C03\u7528\u751F\u6548\u3002", properties: {
    "worlds.surfing.search.maxResults": {
      type: "integer",
      title: "\u6BCF\u6E90\u663E\u793A\u6761\u6570",
      minimum: 1,
      maximum: 10,
      "x-suffix": "\u6761",
      "x-hot": true,
      description: "\u4F5C\u7528\u4E8E B\u7AD9\u548C\u8D34\u5427\u3002"
    },
    "worlds.surfing.search.bili": { type: "boolean", title: "B\u7AD9", "x-hot": true },
    "worlds.surfing.search.tieba": { type: "boolean", title: "\u8D34\u5427", "x-hot": true },
    "worlds.surfing.search.moegirl": { type: "boolean", title: "\u840C\u5A18\u767E\u79D1", "x-hot": true },
    "worlds.surfing.search.baike": { type: "boolean", title: "\u767E\u5EA6\u767E\u79D1", "x-hot": true }
  } }
};
var SURFING_PROXY_CONFIG_GROUP = {
  id: "world:surfing:proxy",
  owner: "world:surfing",
  schema: { type: "object", title: "\u4EE3\u7406", description: "\u6B63\u5728\u4F7F\u7528 Clash \u7B49\u4EE3\u7406\uFF1F\u5982\u679C\u7F51\u9875\u548CB\u7AD9\u8BFB\u53D6\u90FD\u63D0\u793A\u5730\u5740\u9519\u8BEF\uFF0C\u53EF\u4EE5\u5C1D\u8BD5\u5F00\u542F\u4EE3\u7406\u517C\u5BB9\u6A21\u5F0F\u3002", properties: {
    [PROXY_MODE_PATH]: {
      type: "boolean",
      title: "\u4EE3\u7406\u517C\u5BB9\u6A21\u5F0F",
      "x-hot": true,
      "x-warning": true,
      description: "\u5F00\u542F\u540E\uFF0C\u5B9E\u9645\u8BBF\u95EE\u54EA\u91CC\u7531\u4EE3\u7406\u51B3\u5B9A\uFF0C\u53EF\u80FD\u5305\u62EC\u672C\u673A\u6216\u5185\u7F51\u670D\u52A1\u3002\u8BF7\u53EA\u5728\u4FE1\u4EFB\u5F53\u524D\u4EE3\u7406\u65F6\u5F00\u542F\uFF0C\u4E0B\u6B21\u8BFB\u53D6\u751F\u6548\u3002"
    },
    [PROXY_RANGES_PATH]: {
      type: "string",
      title: "\u81EA\u5B9A\u4E49\u5730\u5740\u8303\u56F4\uFF08\u53EF\u9009\uFF09",
      "x-hot": true,
      "x-warning": true,
      description: "\u5E38\u89C1\u5730\u5740\u5DF2\u5185\u7F6E\uFF0C\u53EA\u6709\u6539\u8FC7\u4EE3\u7406\u7684\u5730\u5740\u6C60\u624D\u9700\u8981\u586B\u5199\u3002\u6BCF\u884C\u4E00\u4E2A\uFF0C\u4F8B\u5982 172.19.0.0/16\u3002"
    }
  } }
};
var SURFING_LIMITS_CONFIG_GROUP = {
  id: "world:surfing:limits",
  owner: "world:surfing",
  schema: { type: "object", title: "\u83B7\u53D6\u4E0E\u7F13\u5B58\u9650\u5236", properties: {
    "worlds.surfing.reading.maxSourceChars": {
      type: "integer",
      title: "\u5355\u4EFD\u6750\u6599\u4FDD\u7559\u4E0A\u9650",
      minimum: 1e4,
      maximum: 2e6,
      "x-suffix": "\u5B57\u7B26",
      description: "\u6B63\u6587\u3001\u94FE\u63A5\u5730\u5740\u548C\u641C\u7D22\u7ED3\u679C\u5408\u8BA1\uFF1B\u89E6\u9650\u65F6\u6807\u660E\u6750\u6599\u4E0D\u5B8C\u6574\u3002\u65B0\u8BFB\u53D6\u751F\u6548\u3002"
    },
    "worlds.surfing.network.maxDownloadBytes": {
      type: "integer",
      title: "\u5355\u6B21\u8BFB\u53D6\u4E0B\u8F7D\u4E0A\u9650",
      minimum: 1048576,
      maximum: 67108864,
      "x-scale": 1048576,
      "x-suffix": "MiB",
      description: "\u6309\u89E3\u538B\u540E\u6570\u636E\u7D2F\u8BA1\uFF0C\u5305\u542B\u91CD\u5B9A\u5411\u53CA\u6E32\u67D3\u8BF7\u6C42\u3002"
    },
    "worlds.surfing.network.requestTimeoutMs": {
      type: "integer",
      title: "\u5355\u6B21\u8BFB\u53D6\u8D85\u65F6",
      minimum: 3e3,
      maximum: 12e4,
      "x-scale": 1e3,
      "x-suffix": "\u79D2",
      description: "\u6574\u6B21\u8BFB\u53D6\u5171\u7528\u65F6\u9650\uFF1B\u4E0B\u6B21\u8C03\u7528\u751F\u6548\u3002"
    },
    "worlds.surfing.cache.ttlMs": {
      type: "integer",
      title: "\u7EED\u8BFB\u4FDD\u7559\u65F6\u95F4",
      minimum: 6e4,
      maximum: 72e5,
      "x-scale": 6e4,
      "x-suffix": "\u5206\u949F",
      description: "\u5230\u671F\u9700\u91CD\u65B0\u8BFB\u53D6\uFF1B\u65B0\u5FEB\u7167\u751F\u6548\u3002"
    },
    "worlds.surfing.cache.maxBytes": {
      type: "integer",
      title: "\u6587\u672C\u7F13\u5B58\u4E0A\u9650",
      minimum: 8388608,
      maximum: 268435456,
      "x-scale": 1048576,
      "x-suffix": "MiB",
      description: "\u6309\u4FDD\u5B58\u7684\u6570\u636E\u5927\u5C0F\u6838\u7B97\uFF0C\u8D85\u9650\u6DD8\u6C70\u6700\u4E45\u672A\u8BFB\u7684\u6750\u6599\u3002"
    }
  } }
};
var SURFING_CONFIG_GROUPS = [SURFING_CONFIG_GROUP, SURFING_SEARCH_CONFIG_GROUP, SURFING_PROXY_CONFIG_GROUP, SURFING_LIMITS_CONFIG_GROUP];

// src/webui/client.ts
var errorText = (error) => error instanceof Error ? error.message : "\u64CD\u4F5C\u5931\u8D25";
var showPressed = (toggle, enabled) => {
  toggle.classList.toggle("active", enabled);
  toggle.setAttribute("aria-pressed", String(enabled));
};
async function mount(ctx) {
  const { ui } = ctx;
  const state = await ctx.invoke("state");
  const layout = ui.h("div");
  layout.style.cssText = "display:grid;gap:20px;max-width:960px;margin:auto";
  let saves = Promise.resolve();
  const saveValue = (path, title, saved, value, apply) => {
    saves = saves.then(async () => {
      const next = (await ctx.invoke("save", [path, value])).values[path];
      apply?.(next);
      saved.textContent = `\u5DF2\u4FDD\u5B58\uFF1A${title}`;
      saved.classList.remove("bad");
      void ctx.refresh().catch(() => void 0);
    }).catch((error) => {
      saved.textContent = errorText(error);
      saved.classList.add("bad");
    });
    return saves;
  };
  const proxySheet = () => {
    const { schema } = SURFING_PROXY_CONFIG_GROUP;
    const mode = schema.properties[PROXY_MODE_PATH];
    const ranges = schema.properties[PROXY_RANGES_PATH];
    const sheet = ui.sheet({ title: schema.title, desc: schema.description });
    const saved = ui.msgline("");
    const toggle = ui.h("button", "seg", "\u5F00\u542F");
    toggle.type = "button";
    showPressed(toggle, state.values[PROXY_MODE_PATH] === true);
    toggle.addEventListener("click", () => {
      toggle.disabled = true;
      void saveValue(PROXY_MODE_PATH, mode.title, saved, !toggle.classList.contains("active"), (next) => showPressed(toggle, next === true)).finally(() => {
        toggle.disabled = false;
      });
    }, { signal: ctx.signal });
    const caption = ui.h("span", "fieldlabel", mode.title);
    caption.id = "surfing-proxy-mode";
    caption.style.color = "var(--warn)";
    const note = ui.h("small", "muted", mode.description);
    note.id = "surfing-proxy-mode-note";
    const bar = ui.h("div", "segwrap umulti");
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-labelledby", caption.id);
    bar.setAttribute("aria-describedby", note.id);
    bar.append(toggle);
    const field = ui.h("div", "fieldrow");
    field.append(caption, bar);
    const row = ui.h("div");
    row.append(field, note);
    const advanced = ui.foldSheet("surfing-proxy-advanced", { title: "\u9AD8\u7EA7\u8BBE\u7F6E", defaultOpen: false });
    const rangesSaved = ui.msgline("");
    const input = ui.textarea({
      cls: "mono",
      rows: 4,
      value: String(state.values[PROXY_RANGES_PATH]),
      onChange: (value) => {
        void saveValue(PROXY_RANGES_PATH, ranges.title, rangesSaved, value);
      }
    });
    const rangesNote = ui.h("small", "muted", ranges.description);
    rangesNote.id = "surfing-proxy-ranges-note";
    input.setAttribute("aria-describedby", rangesNote.id);
    const rangesField = ui.field(ranges.title, input);
    rangesField.querySelector(".fieldlabel").style.color = "var(--warn)";
    advanced.body.append(rangesField, rangesNote, rangesSaved);
    sheet.body.append(row, saved, advanced.el);
    return sheet.el;
  };
  for (const group of SURFING_CONFIG_GROUPS) {
    if (group === SURFING_PROXY_CONFIG_GROUP) {
      layout.append(proxySheet());
      continue;
    }
    const sheet = group === SURFING_LIMITS_CONFIG_GROUP ? ui.foldSheet("surfing-limits", { title: group.schema.title, defaultOpen: false }) : ui.sheet({ title: group.schema.title });
    const grid = ui.h("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:16px 24px";
    const saved = ui.msgline("");
    const toggles = ui.h("div", "segwrap umulti");
    for (const [path, property] of Object.entries(group.schema.properties)) {
      const save = (value, apply) => {
        void saveValue(path, property.title, saved, value, apply);
      };
      if (property.type === "boolean") {
        const toggle = ui.h("button", "seg", property.title);
        toggle.type = "button";
        showPressed(toggle, state.values[path] === true);
        toggle.addEventListener("click", () => {
          const value = !toggle.classList.contains("active");
          showPressed(toggle, value);
          save(value);
        }, { signal: ctx.signal });
        toggles.append(toggle);
        continue;
      }
      const note = ui.h("small", "muted", property.description);
      note.id = path;
      const scale = property["x-scale"] ?? 1;
      const input = ui.input({ type: "number", value: String(Number(state.values[path]) / scale), onChange: (value) => {
        save(Number(value) * scale, (next) => {
          if (input.value === value) input.value = String(Number(next) / scale);
        });
      } });
      input.min = String(property.minimum / scale);
      input.max = String(property.maximum / scale);
      input.setAttribute("aria-describedby", note.id);
      const row = ui.h("div");
      row.append(ui.field(`${property.title}\uFF08${property["x-suffix"]}\uFF09`, input), note);
      grid.append(row);
    }
    if (toggles.children.length) {
      const caption = ui.h("span", "fieldlabel", "\u6765\u6E90");
      caption.id = `${group.id}:sources`;
      toggles.setAttribute("role", "group");
      toggles.setAttribute("aria-labelledby", caption.id);
      const note = ui.h("small", "muted", group.schema.description);
      note.id = `${group.id}:sources-note`;
      toggles.setAttribute("aria-describedby", note.id);
      const field = ui.h("div", "fieldrow");
      field.append(caption, toggles);
      const row = ui.h("div");
      row.append(field, note);
      grid.append(row);
    }
    sheet.body.append(grid, saved);
    layout.append(sheet.el);
  }
  const anchor = (text, href) => {
    const link = ui.h("a", null, text);
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  };
  const keyStatus = ui.msgline("");
  let keyPill = ui.pill("", "off");
  const showKey = (keySet) => {
    const next = ui.pill(keySet ? "API Key \u5DF2\u914D\u7F6E" : "\u514D Key", keySet ? "on" : "off");
    keyPill.replaceWith(next);
    keyPill = next;
  };
  async function keyAction(run) {
    try {
      keyStatus.textContent = await run();
      keyStatus.classList.remove("bad");
    } catch (error) {
      keyStatus.textContent = errorText(error);
      keyStatus.classList.add("bad");
    }
  }
  const keyBar = ui.rowbar();
  keyBar.append(
    keyPill,
    ui.button("\u6253\u5F00\u5BC6\u94A5\u6587\u4EF6", { onClick: () => {
      void keyAction(async () => {
        await ctx.invoke("openKeyFile");
        return "\u5DF2\u6253\u5F00\u5BC6\u94A5\u6587\u4EF6";
      });
    } }),
    ui.button("\u5237\u65B0\u5BC6\u94A5\u72B6\u6001", { onClick: () => {
      void keyAction(async () => {
        showKey((await ctx.invoke("state")).keySet);
        void ctx.refresh().catch(() => void 0);
        return "\u5DF2\u5237\u65B0\u5BC6\u94A5\u72B6\u6001";
      });
    } }),
    keyStatus
  );
  showKey(state.keySet);
  const steps = ui.h("ol");
  steps.style.cssText = "list-style:decimal;padding-left:24px;margin:6px 0;line-height:1.8";
  const secret = ui.h("code", "mono", `${SURFING_MICROLINK_SECRET}=`);
  for (const parts of [
    ["\u6253\u5F00", anchor("Microlink \u6CE8\u518C\u9875", "https://dashboard.microlink.io/signup"), "\uFF0C\u6CE8\u518C\u8D26\u53F7\u5E76\u767B\u5F55\uFF0C\u65E0\u9700\u8D2D\u4E70\u4ED8\u8D39\u5957\u9910\u3002"],
    ["\u5728\u63A7\u5236\u53F0\u5DE6\u4FA7\u9009\u62E9\u300COverview\u300D\uFF0C\u70B9\u51FB\u300CUsage\u300D\u6807\u7B7E\u3002"],
    ["\u70B9\u51FB\u300CDevelopment\u300D\u6807\u7B7E\u53F3\u4E0A\u89D2\u7684\u300C\u2026\u300D\uFF0C\u590D\u5236 API Key\u3002"],
    ["\u70B9\u51FB\u300C\u6253\u5F00\u5BC6\u94A5\u6587\u4EF6\u300D\uFF0C\u5C06 Key \u586B\u5728 ", secret, " \u540E\u9762\uFF0C\u4E0D\u52A0\u5F15\u53F7\uFF0C\u4FDD\u5B58\u6587\u4EF6\u3002"],
    ["\u4FDD\u5B58\u540E\uFF0C\u4E0B\u6B21\u8FDC\u7A0B\u8BFB\u53D6\u4F7F\u7528\u8BE5 Key \u7684\u989D\u5EA6\u3002\u70B9\u51FB\u300C\u5237\u65B0\u5BC6\u94A5\u72B6\u6001\u300D\u53EF\u67E5\u770B\u914D\u7F6E\u72B6\u6001\u3002\u6E05\u7A7A Key \u7684\u503C\u5E76\u4FDD\u5B58\u53EF\u6062\u590D\u514D Key \u8C03\u7528\u3002"]
  ]) {
    const step = ui.h("li");
    step.append(...parts);
    steps.append(step);
  }
  const limits = ui.h("p", "muted");
  limits.append("\u514D Key \u548C\u514D\u8D39 Key \u7684\u989D\u5EA6\u4E0D\u540C\uFF0C\u5F53\u524D\u9650\u5236\u89C1", anchor("Microlink \u989D\u5EA6\u8BF4\u660E", "https://microlink.io/docs/api/basics/rate-limit"), "\u3002");
  const microlink = ui.sheet({
    title: "Microlink \u8FDC\u7A0B\u6E32\u67D3",
    desc: "\u672C\u673A Chromium \u4E0D\u53EF\u7528\u65F6\uFF0C\u5C06\u7F51\u9875 URL \u4EA4\u7ED9 Microlink \u6E32\u67D3\u3002API Key \u53EF\u9009\uFF0C\u7559\u7A7A\u4F7F\u7528\u514D Key \u989D\u5EA6\u3002"
  });
  const help = ui.foldSheet("surfing-microlink-key", { title: "\u5982\u4F55\u53D6\u5F97 API Key", defaultOpen: false });
  help.body.append(steps, limits);
  microlink.body.append(keyBar, help.el);
  layout.append(microlink.el);
  ctx.root.replaceChildren(layout);
}
var client_default = { panels: { config: { mount } } };
export {
  client_default as default
};
