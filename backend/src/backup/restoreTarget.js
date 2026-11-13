import { checksumValue } from './inventory.js';

/** Restore targets must be disposable local replica-set databases, never the application database. */
export function assertIsolatedRestoreTargetUri(uri, targetClassification, sourceDatabase) {
  let parsed;
  try { parsed = new URL(uri); } catch { throw new Error('Invalid isolated target URI'); }
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  const hosts = parsed.host.split(',').map(host => host.replace(/:\d+$/, '').toLowerCase());
  if (parsed.protocol !== 'mongodb:' || targetClassification !== 'isolated-test'
    || !hosts.length || hosts.some(host => !['127.0.0.1', 'localhost', '[::1]'].includes(host))
    || !name || name === sourceDatabase
    || /(?:^|[-_])(prod|production|live|atlas)(?:[-_]|$)/i.test(name)) {
    throw new Error('Restore URI requires isolated-test classification and a local disposable cluster');
  }
  return name;
}

export async function assertIsolatedRestoreTarget({ targetConnection, targetDbName, sourceDatabase, targetClassification }) {
  if (!targetConnection?.db || !targetDbName || targetConnection.db.databaseName !== targetDbName) {
    throw new Error('An explicit matching target database name and connected target are required');
  }
  if (targetDbName === sourceDatabase) {
    throw new Error('Source and target must be distinct');
  }
  const hosts = targetConnection.client?.options?.hosts ?? [];
  if (targetClassification !== 'isolated-test' || !hosts.length
    || hosts.some(host => !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host.host))
    || /(?:^|[-_])(prod|production|live|atlas)(?:[-_]|$)/i.test(targetDbName)) {
    throw new Error('Restore target requires isolated-test classification on a local disposable cluster');
  }
  const hello = await targetConnection.db.admin().command({ hello: 1 });
  const clusterHosts = hello.hosts ?? [];
  if (!hello.setName || !clusterHosts.length || clusterHosts.some(host =>
    !/^(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/i.test(host))) {
    throw new Error('Restore target must identify as an isolated local replica set');
  }
  return checksumValue({ setName: hello.setName, hosts: [...clusterHosts].sort() });
}
