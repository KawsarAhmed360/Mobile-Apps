import { networkInterfaces } from 'node:os';

export function privateIPv4(address: string): boolean {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) return false;
  const parts = address.split('.').map(Number);
  return parts.every(part => part >= 0 && part <= 255) && (
    parts[0] === 10 ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
  );
}

export function chooseAddress(): string | undefined {
  const addresses = Object.entries(networkInterfaces())
    .filter(([name]) => !/^(utun|bridge|docker|veth|vmnet|lo|awdl|llw)/i.test(name))
    .flatMap(([name, entries]) => (entries ?? [])
      .filter(entry => entry.family === 'IPv4' && !entry.internal && privateIPv4(entry.address))
      .map(entry => ({ name, address: entry.address })));
  const rank = (name: string) => name === 'en0' ? 0 : name === 'en1' ? 1 : 2;
  addresses.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
  return addresses[0]?.address;
}
