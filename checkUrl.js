const https = require('https');

// 测试连接
function testConnection(hostname) {
  return new Promise((resolve, reject) => {
    const req = https.get(`https://${hostname}`, (res) => {
      console.log(`✓ ${hostname} 可访问 (状态码: ${res.statusCode})`);
      resolve(true);
    });
    
    req.on('error', (error) => {
      console.error(`✗ ${hostname} 无法访问:`, error.message);
      resolve(false);
    });
    
    req.setTimeout(5000, () => {
      req.destroy();
      console.error(`✗ ${hostname} 连接超时`);
      resolve(false);
    });
  });
}

async function checkNetwork() {
  console.log('检查网络连接...\n');
  
  await testConnection('web3.okx.com');
  await testConnection('www.okx.com');
  await testConnection('google.com');
  
  console.log('\n如果 OKX 域名无法访问，可能需要配置代理');
}

checkNetwork();