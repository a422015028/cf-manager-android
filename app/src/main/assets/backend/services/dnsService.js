"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listDnsRecords = listDnsRecords;
exports.createDnsRecord = createDnsRecord;
exports.updateDnsRecord = updateDnsRecord;
exports.deleteDnsRecord = deleteDnsRecord;
const cfFactory_1 = require("./cfFactory");
async function listDnsRecords(account, zoneId) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    const records = [];
    for await (const record of cf.dns.records.list({ zone_id: zoneId, per_page: 100 })) {
        records.push(record);
    }
    return records;
}
async function createDnsRecord(account, zoneId, data) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    return await cf.dns.records.create({ zone_id: zoneId, ...data });
}
async function updateDnsRecord(account, zoneId, recordId, data) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    return await cf.dns.records.edit(recordId, { zone_id: zoneId, ...data });
}
async function deleteDnsRecord(account, zoneId, recordId) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    await cf.dns.records.delete(recordId, { zone_id: zoneId });
}
//# sourceMappingURL=dnsService.js.map