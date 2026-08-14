/**
 * 腾讯云 SCF Web 函数入口（API 网关触发器）。
 * 部署方式：将整个项目目录打包上传为函数代码，入口设为 scf.main_handler。
 * 页面与 API 同源，无 CORS 问题。
 */
const { route } = require('./handler');

exports.main_handler = async (event) => {
  const method = event.httpMethod || event.requestContext?.http?.method || 'GET';
  const path = event.path || event.requestContext?.http?.path || '/';
  const ip =
    event.requestContext?.sourceIp ||
    event.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
    'unknown';

  let body;
  if (event.body) {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf-8')
      : event.body;
    try {
      body = JSON.parse(raw);
    } catch (_) {
      body = undefined;
    }
  }

  const res = await route({ method, path, body, ip });
  return {
    statusCode: res.status,
    headers: res.headers,
    body: res.body,
    isBase64Encoded: false,
  };
};
