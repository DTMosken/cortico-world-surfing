import { generate } from 'selfsigned';

export const browserTls = generate([{ name: 'commonName', value: 'example.org' }], {
  keyType: 'ec', algorithm: 'sha256',
}).then(pems => ({ key: pems.private, cert: pems.cert }));
