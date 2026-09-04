"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensurePagesProject = ensurePagesProject;
exports.validatePagesProjectName = validatePagesProjectName;
exports.listPages = listPages;
exports.deletePagesProject = deletePagesProject;
exports.getPagesProject = getPagesProject;
exports.editPagesProject = editPagesProject;
exports.listPagesDomains = listPagesDomains;
exports.addPagesDomain = addPagesDomain;
exports.removePagesDomain = removePagesDomain;
exports.listPagesDeployments = listPagesDeployments;
exports.deletePagesDeployment = deletePagesDeployment;
exports.batchDeletePagesDeployments = batchDeletePagesDeployments;
exports.updatePagesBindings = updatePagesBindings;
const cfFactory_1 = require("./cfFactory");
const logger_1 = require("./logger");
const accountRouter_1 = require("./accountRouter");
// 确保 Pages 项目存在，已存在时忽略 409 错误
async function ensurePagesProject(account, projectName) {
    const accountId = account.account_id;
    if (!accountId)
        throw new Error('Account ID is required');
    const cf = (0, cfFactory_1.getCfClient)(account);
    try {
        await cf.pages.projects.create({ account_id: accountId, name: projectName, production_branch: 'main' });
    }
    catch (e) {
        if (e?.status !== 409)
            throw e; // 409 = already exists, ignore
    }
}
// Pages 项目名称校验：Cloudflare 要求 ^[a-z0-9][a-z0-9-]*$
function validatePagesProjectName(name) {
    return /^[a-z0-9][a-z0-9-]*$/.test(name);
}
async function listPages(account) {
    const accountId = account.account_id;
    if (!accountId)
        return [];
    const cf = (0, cfFactory_1.getCfClient)(account);
    const projects = [];
    for await (const project of cf.pages.projects.list({ account_id: accountId })) {
        projects.push(project);
    }
    return projects;
}
async function deletePagesProject(account, name) {
    const accountId = account.account_id;
    const cf = (0, cfFactory_1.getCfClient)(account);
    await cf.pages.projects.delete(name, { account_id: accountId });
}
async function getPagesProject(account, projectName) {
    const accountId = account.account_id;
    const cf = (0, cfFactory_1.getCfClient)(account);
    return await cf.pages.projects.get(projectName, { account_id: accountId });
}
async function editPagesProject(account, projectName, params) {
    const accountId = account.account_id;
    const cf = (0, cfFactory_1.getCfClient)(account);
    const envVarsDebug = JSON.stringify(params?.deployment_configs?.production?.env_vars || params?.deployment_configs?.production?.env_vars);
    console.log(`[DBG] editPagesProject ${projectName} productionEnvVars=${envVarsDebug}`);
    console.log(`[DBG] editPagesProject ${projectName} fullParams=${JSON.stringify(params)}`);
    const res = await cf.pages.projects.edit(projectName, { account_id: accountId, ...params });
    console.log(`[DBG] editPagesProject resultEnvVars=${JSON.stringify(res?.deployment_configs?.production?.env_vars)}`);
    return res;
}
async function listPagesDomains(account, projectName) {
    const accountId = account.account_id;
    const cf = (0, cfFactory_1.getCfClient)(account);
    const domains = [];
    for await (const d of cf.pages.projects.domains.list(projectName, { account_id: accountId })) {
        domains.push(d);
    }
    return domains;
}
async function addPagesDomain(account, projectName, hostname) {
    const accountId = account.account_id;
    const cf = (0, cfFactory_1.getCfClient)(account);
    // 1. Get Pages project info to find the real subdomain
    let pagesSubdomain;
    try {
        const projectInfo = await cf.pages.projects.get(projectName, { account_id: accountId });
        // Real subdomain format: {projectName}.{accountSubdomain}.pages.dev
        pagesSubdomain = projectInfo.subdomain || `${projectName}.pages.dev`;
        logger_1.appLogger.info(`[Pages Domain] Real subdomain: ${pagesSubdomain}`);
    }
    catch (_e) {
        // Fallback to old format if API fails
        pagesSubdomain = `${projectName}.pages.dev`;
        logger_1.appLogger.warn(`[Pages Domain] Failed to get project info, using fallback: ${pagesSubdomain}`);
    }
    // 2. Create the Pages domain association
    const result = await cf.pages.projects.domains.create(projectName, { account_id: accountId, name: hostname });
    // 3. Automatically create CNAME DNS record if zone is in the same account
    try {
        const allZones = await (0, accountRouter_1.getAllZones)();
        const accountZones = allZones.filter(z => z.cfAccountId === account.id);
        const matchingZone = accountZones.find((z) => hostname.endsWith('.' + z.name) || hostname === z.name);
        if (matchingZone) {
            const existing = [];
            for await (const r of cf.dns.records.list({ zone_id: matchingZone.id, type: 'CNAME', name: { exact: hostname } })) {
                existing.push(r);
            }
            if (existing.length === 0) {
                await cf.dns.records.create({
                    zone_id: matchingZone.id,
                    type: 'CNAME',
                    name: hostname,
                    content: pagesSubdomain,
                    proxied: true,
                    ttl: 1,
                });
                logger_1.appLogger.info(`[Pages Domain] Created CNAME: ${hostname} → ${pagesSubdomain} (proxied)`);
            }
            else {
                logger_1.appLogger.info(`[Pages Domain] CNAME already exists for ${hostname}, skipping`);
            }
        }
        else {
            logger_1.appLogger.info(`[Pages Domain] No matching zone found for ${hostname}, skipping CNAME creation`);
        }
    }
    catch (dnsErr) {
        logger_1.appLogger.error(`[Pages Domain] Failed to auto-create DNS record: ${dnsErr}`);
    }
    return result;
}
async function removePagesDomain(account, projectName, hostname) {
    const accountId = account.account_id;
    const cf = (0, cfFactory_1.getCfClient)(account);
    // 1. Remove the Pages domain association
    const result = await cf.pages.projects.domains.delete(projectName, hostname, { account_id: accountId });
    // 2. Clean up CNAME DNS record
    try {
        const allZones = await (0, accountRouter_1.getAllZones)();
        const accountZones = allZones.filter(z => z.cfAccountId === account.id);
        const matchingZone = accountZones.find((z) => hostname.endsWith('.' + z.name) || hostname === z.name);
        if (matchingZone) {
            const records = [];
            for await (const r of cf.dns.records.list({ zone_id: matchingZone.id, type: 'CNAME', name: { exact: hostname } })) {
                records.push(r);
            }
            for (const r of records) {
                if (r.content?.endsWith('.pages.dev')) {
                    await cf.dns.records.delete(r.id, { zone_id: matchingZone.id });
                    logger_1.appLogger.info(`[Pages Domain] Deleted CNAME: ${hostname} → ${r.content}`);
                }
            }
        }
    }
    catch (dnsErr) {
        logger_1.appLogger.error(`[Pages Domain] Failed to delete DNS record: ${dnsErr}`);
    }
    return result;
}
async function listPagesDeployments(account, projectName) {
    const accountId = account.account_id;
    const cf = (0, cfFactory_1.getCfClient)(account);
    const deps = [];
    for await (const d of cf.pages.projects.deployments.list(projectName, { account_id: accountId })) {
        deps.push(d);
    }
    return deps;
}
async function deletePagesDeployment(account, projectName, deploymentId) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    try {
        await cf.pages.projects.deployments.delete(projectName, deploymentId, {
            account_id: account.account_id,
        });
        return { success: true };
    }
    catch (err) {
        logger_1.appLogger.error(`[Pages Deployment] Delete failed: ${deploymentId} — ${err?.message || err}`);
        return { success: false, error: err?.message || String(err) };
    }
}
/**
 * 批量删除 Pages 部署记录（受控并发，最多 3 条并行）
 */
async function batchDeletePagesDeployments(account, projectName, ids) {
    const CONCURRENCY = 3;
    const results = [];
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
        const batch = ids.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.allSettled(batch.map(id => deletePagesDeployment(account, projectName, id)));
        batchResults.forEach((r, j) => {
            if (r.status === 'fulfilled') {
                results.push({ id: batch[j], ...r.value });
            }
            else {
                results.push({ id: batch[j], success: false, error: String(r.reason) });
            }
        });
    }
    const succeeded = results.filter(r => r.success).length;
    return { total: ids.length, succeeded, failed: ids.length - succeeded, results };
}
async function updatePagesBindings(account, projectName, deploymentConfigs) {
    return await editPagesProject(account, projectName, { deployment_configs: deploymentConfigs });
}
//# sourceMappingURL=pagesService.js.map