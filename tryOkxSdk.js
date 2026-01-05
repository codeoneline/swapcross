const { OKXDexClient } = require('@okx-dex/okx-dex-sdk')
require('dotenv/config')

// 初始化DEX客户端
const client = new OKXDexClient({
  apiKey: process.env.OKX_API_KEY, // 从环境变量获取API密钥
  secretKey: process.env.OKX_SECRET_KEY, // 安全凭证密钥
  apiPassphrase: process.env.OKX_API_PASSPHRASE, // 加密口令
  projectId: process.env.OKX_PROJECT_ID, // 开发者平台创建的项目ID
  // 链上交互配置（以Solana为例）
  solana: {
    connection: {
      rpcUrl: process.env.SOLANA_RPC_URL, // 节点RPC地址
      confirmTransactionInitialTimeout: 60000 // 交易确认超时设置
    },
    privateKey: process.env.SOLANA_PRIVATE_KEY, // 钱包私钥（加密存储）
    walletAddress: process.env.SOLANA_WALLET_ADDRESS // 钱包地址
  },
});
console.log('环境变量检查:');
console.log('- PROJECT_ID:', process.env.OKX_PROJECT_ID ? '已设置' : '❌ 未设置');
console.log('- API_KEY:', process.env.OKX_API_KEY ? '已设置' : '未设置（DEX不需要）');
async function main() {
  try {
      // 获取兑换报价
      const quote = await client.dex.getQuote({
          chainIndex: '501', // Solana主网链ID
          fromTokenAddress: 'So11111111111111111111111111111111111111112', // SOL代币地址
          toTokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC代币地址
          amount: '1000000000', // 兑换数量（基础单位精度）
          slippagePercent: '0.5' // 滑点容忍度（0.5%）
      });
      console.log('兑换报价详情:', JSON.stringify(quote, null, 2));
  } catch (error) {
      console.error('交易异常:', error);
  }
}

// 执行报价查询
main();