const { ethers } = require('ethers');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { HttpProxyAgent } = require('http-proxy-agent');

/**
 * OKX DEX V6 代币兑换脚本
 * 功能：在BSC上将USDT兑换成USDC
 */

// 配置信息
const CONFIG = {
  // BSC主网RPC
  RPC_URL: 'https://bsc-dataseed1.binance.org',
  
  // OKX DEX API v6
  API_BASE_URL: 'https://www.okx.com/api/v5/dex/aggregator',
  
  // BSC链ID
  CHAIN_ID: '56',
  
  // 代币地址
  TOKENS: {
    USDT: '0x55d398326f99059fF775485246999027B3197955', // BSC USDT
    USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', // BSC USDC
  },
  
  // 滑点容忍度（0.5%）
  SLIPPAGE: '0.5',
  
  // 代理配置
  PROXY: {
    enabled: true, // 是否启用代理
    url: 'http://127.0.0.1:7897', // 代理地址
  },
};

// ERC20 ABI（只包含需要的函数）
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
];

class OKXDEXSwapper {
  constructor(privateKey) {
    // 配置代理
    this.setupProxy();
    
    // 初始化provider和wallet
    this.provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL, undefined, {
      fetchOptions: this.fetchOptions,
    });
    this.wallet = new ethers.Wallet(privateKey, this.provider);
    console.log(`钱包地址: ${this.wallet.address}`);
  }

  /**
   * 设置代理配置
   */
  setupProxy() {
    if (CONFIG.PROXY.enabled) {
      const proxyUrl = CONFIG.PROXY.url;
      
      // 创建代理agent
      if (proxyUrl.startsWith('https://')) {
        this.proxyAgent = new HttpsProxyAgent(proxyUrl);
      } else {
        this.proxyAgent = new HttpProxyAgent(proxyUrl);
      }

      // 为ethers.js配置fetch选项
      this.fetchOptions = {
        agent: this.proxyAgent,
      };

      // 为axios配置代理
      this.axiosConfig = {
        proxy: false, // 禁用axios默认代理配置
        httpAgent: new HttpProxyAgent(proxyUrl),
        httpsAgent: new HttpsProxyAgent(proxyUrl),
      };

      console.log(`✅ 代理已配置: ${proxyUrl}`);
    } else {
      this.fetchOptions = {};
      this.axiosConfig = {};
      console.log('ℹ️  未启用代理');
    }
  }

  /**
   * 获取代币信息
   */
  async getTokenInfo(tokenAddress) {
    // 规范化地址格式（修复checksum）
    const normalizedAddress = ethers.getAddress(tokenAddress);
    const tokenContract = new ethers.Contract(normalizedAddress, ERC20_ABI, this.provider);
    const decimals = await tokenContract.decimals();
    const balance = await tokenContract.balanceOf(this.wallet.address);
    
    return {
      decimals: Number(decimals),
      balance: balance.toString(),
      balanceFormatted: ethers.formatUnits(balance, decimals),
    };
  }

  /**
   * 检查并授权代币
   */
  async approveToken(tokenAddress, spender, amount) {
    // 规范化地址格式（修复checksum）
    const normalizedTokenAddress = ethers.getAddress(tokenAddress);
    const normalizedSpender = ethers.getAddress(spender);
    
    const tokenContract = new ethers.Contract(normalizedTokenAddress, ERC20_ABI, this.wallet);
    
    // 检查当前授权额度
    const currentAllowance = await tokenContract.allowance(this.wallet.address, normalizedSpender);
    
    if (currentAllowance < amount) {
      console.log('授权代币中...');
      const approveTx = await tokenContract.approve(normalizedSpender, ethers.MaxUint256);
      console.log(`授权交易哈希: ${approveTx.hash}`);
      
      await approveTx.wait();
      console.log('✅ 授权成功');
    } else {
      console.log('✅ 已有足够的授权额度');
    }
  }

  /**
   * 获取兑换报价
   */
  async getQuote(fromToken, toToken, amount) {
    try {
      const url = `${CONFIG.API_BASE_URL}/quote`;
      const params = {
        chainId: CONFIG.CHAIN_ID,
        fromTokenAddress: fromToken,
        toTokenAddress: toToken,
        amount: amount,
      };

      console.log('\n📊 获取兑换报价...');
      console.log(`请求参数:`, params);
      
      const response = await axios.get(url, { 
        params,
        ...this.axiosConfig, // 添加代理配置
      });

      console.log(`API响应码: ${response.data.code}`);
      
      if (response.data.code !== '0') {
        // 详细的错误信息
        console.error(`❌ API错误详情:`);
        console.error(`  - 错误码: ${response.data.code}`);
        console.error(`  - 错误信息: ${response.data.msg}`);
        
        // 针对特定错误提供建议
        if (response.data.code === '82000') {
          console.error(`\n💡 流动性不足的可能原因:`);
          console.error(`  1. 兑换金额太小 (当前: ${amount} wei)`);
          console.error(`  2. 该交易对流动性不足`);
          console.error(`  3. 尝试增加兑换金额或更换交易对`);
        }
        
        throw new Error(`API错误 [${response.data.code}]: ${response.data.msg}`);
      }

      const quote = response.data.data[0];
      console.log(`✅ 预计获得: ${ethers.formatUnits(quote.toTokenAmount, quote.toTokenDecimal)} ${quote.toTokenSymbol}`);
      console.log(`路由路径: ${quote.routerList.map(r => r.router).join(' -> ')}`);
      
      return quote;
    } catch (error) {
      console.error('获取报价失败:', error.message);
      throw error;
    }
  }

  /**
   * 获取兑换交易数据
   */
  async getSwapData(fromToken, toToken, amount, slippage, userWalletAddress) {
    try {
      const url = `${CONFIG.API_BASE_URL}/swap`;
      const params = {
        chainId: CONFIG.CHAIN_ID,
        fromTokenAddress: fromToken,
        toTokenAddress: toToken,
        amount: amount,
        slippage: slippage,
        userWalletAddress: userWalletAddress,
      };

      console.log('\n🔄 获取兑换交易数据...');
      const response = await axios.get(url, { 
        params,
        ...this.axiosConfig, // 添加代理配置
      });

      if (response.data.code !== '0') {
        throw new Error(`API错误: ${response.data.msg}`);
      }

      return response.data.data[0];
    } catch (error) {
      console.error('获取兑换数据失败:', error.message);
      throw error;
    }
  }

  /**
   * 执行兑换
   */
  async executeSwap(fromToken, toToken, amount) {
    try {
      console.log('\n=== 开始兑换流程 ===\n');

      // 规范化地址格式
      const normalizedFromToken = ethers.getAddress(fromToken);
      const normalizedToToken = ethers.getAddress(toToken);

      // 1. 获取代币信息
      console.log('📋 获取代币信息...');
      const fromTokenInfo = await this.getTokenInfo(normalizedFromToken);
      const toTokenInfo = await this.getTokenInfo(normalizedToToken);
      
      console.log(`USDT余额: ${fromTokenInfo.balanceFormatted}`);
      console.log(`USDC余额: ${toTokenInfo.balanceFormatted}`);

      // 转换金额为最小单位
      const amountInWei = ethers.parseUnits(amount, fromTokenInfo.decimals).toString();

      // 2. 获取报价
      const quote = await this.getQuote(normalizedFromToken, normalizedToToken, amountInWei);

      // 3. 获取兑换交易数据
      const swapData = await this.getSwapData(
        normalizedFromToken,
        normalizedToToken,
        amountInWei,
        CONFIG.SLIPPAGE,
        this.wallet.address
      );

      // 4. 授权代币（swapData.tx.to 也需要规范化）
      const normalizedRouterAddress = ethers.getAddress(swapData.tx.to);
      await this.approveToken(normalizedFromToken, normalizedRouterAddress, BigInt(amountInWei));

      // 5. 执行交易
      console.log('\n💫 执行兑换交易...');
      const tx = {
        from: ethers.getAddress(swapData.tx.from),
        to: normalizedRouterAddress,
        data: swapData.tx.data,
        value: swapData.tx.value || '0',
        gasLimit: Math.floor(Number(swapData.tx.gas) * 1.2), // 增加20%的gas限制
      };

      const transaction = await this.wallet.sendTransaction(tx);
      console.log(`交易哈希: ${transaction.hash}`);
      console.log('⏳ 等待交易确认...');

      const receipt = await transaction.wait();
      console.log(`✅ 交易成功! 区块高度: ${receipt.blockNumber}`);

      // 6. 显示兑换后的余额
      console.log('\n📊 兑换后余额:');
      const newFromBalance = await this.getTokenInfo(normalizedFromToken);
      const newToBalance = await this.getTokenInfo(normalizedToToken);
      console.log(`USDT余额: ${newFromBalance.balanceFormatted}`);
      console.log(`USDC余额: ${newToBalance.balanceFormatted}`);

      return {
        txHash: transaction.hash,
        blockNumber: receipt.blockNumber,
        status: receipt.status === 1 ? 'success' : 'failed',
      };
    } catch (error) {
      console.error('\n❌ 兑换失败:', error.message);
      throw error;
    }
  }

  /**
   * 获取支持的代币列表
   */
  async getSupportedTokens() {
    try {
      const url = `${CONFIG.API_BASE_URL}/supported/chain`;
      const response = await axios.get(url, {
        params: { chainId: CONFIG.CHAIN_ID },
        ...this.axiosConfig, // 添加代理配置
      });

      if (response.data.code === '0') {
        return response.data.data;
      }
    } catch (error) {
      console.error('获取支持的代币失败:', error.message);
    }
  }
}

/**
 * 主函数
 */
async function main() {
  // ⚠️ 请替换为你的私钥
  const PRIVATE_KEY = 'YOUR_PRIVATE_KEY_HERE';
  
  if (PRIVATE_KEY === 'YOUR_PRIVATE_KEY_HERE') {
    console.error('❌ 请先设置你的私钥!');
    console.log('在代码中替换 YOUR_PRIVATE_KEY_HERE 为你的实际私钥');
    return;
  }

  try {
    const swapper = new OKXDEXSwapper(PRIVATE_KEY);

    // 兑换金额（USDT）
    // 注意：金额需要转换为 wei 单位
    // 1 USDT = 1000000 (USDT是6位小数)
    // 10 USDT = 10000000
    const amountToSwap = '10'; // 兑换10 USDT
    
    console.log('\n========================================');
    console.log(`开始兑换: ${amountToSwap} USDT -> USDC`);
    console.log(`滑点设置: ${CONFIG.SLIPPAGE}%`);
    console.log('========================================');

    // 执行兑换
    const result = await swapper.executeSwap(
      CONFIG.TOKENS.USDT,
      CONFIG.TOKENS.USDC,
      amountToSwap
    );

    console.log('\n🎉 兑换完成!');
    console.log(`交易哈希: https://bscscan.com/tx/${result.txHash}`);
  } catch (error) {
    console.error('执行失败:', error);
    
    // 提供更多帮助信息
    if (error.message.includes('82000')) {
      console.log('\n💡 解决建议:');
      console.log('1. 确认兑换金额是否合理（不要太小）');
      console.log('2. 检查代币地址是否正确');
      console.log('3. 尝试增加兑换金额');
      console.log('4. 更换其他流动性更好的交易对');
    }
  }
}

// 辅助函数：测试不同金额
async function testDifferentAmounts() {
  const PRIVATE_KEY = 'YOUR_PRIVATE_KEY_HERE';
  const swapper = new OKXDEXSwapper(PRIVATE_KEY);
  
  // 测试不同的金额
  const testAmounts = ['0.01', '0.1', '1', '10', '100'];
  
  console.log('\n=== 测试不同金额的流动性 ===\n');
  
  for (const amount of testAmounts) {
    try {
      const amountInWei = ethers.parseUnits(amount, 18).toString();
      console.log(`\n测试金额: ${amount} USDT`);
      
      const quote = await swapper.getQuote(
        CONFIG.TOKENS.USDT,
        CONFIG.TOKENS.USDC,
        amountInWei
      );
      
      console.log(`✅ ${amount} USDT 有足够流动性`);
    } catch (error) {
      console.log(`❌ ${amount} USDT 流动性不足或出错: ${error.message}`);
    }
  }
}

// 运行主函数
if (require.main === module) {
  main();
}

module.exports = { OKXDEXSwapper, CONFIG };

/**
 * 使用说明：
 * 
 * 1. 安装依赖：
 *    npm install ethers axios https-proxy-agent http-proxy-agent
 * 
 * 2. 配置代理：
 *    在 CONFIG.PROXY 中设置：
 *    - enabled: true/false (是否启用代理)
 *    - url: 代理地址 (如 'http://127.0.0.1:7897')
 * 
 * 3. 配置私钥：
 *    将 YOUR_PRIVATE_KEY_HERE 替换为你的BSC钱包私钥
 * 
 * 4. 运行脚本：
 *    node okx_dex_swap.js
 * 
 * 5. 注意事项：
 *    - 确保钱包中有足够的USDT和BNB（用于gas费）
 *    - 首次使用需要授权USDT代币
 *    - 可以调整CONFIG.SLIPPAGE来设置滑点容忍度
 *    - 建议先在测试网测试
 *    - 确保代理服务器正常运行
 * 
 * 6. 代理配置示例：
 *    HTTP代理:  'http://127.0.0.1:7897'
 *    HTTPS代理: 'https://127.0.0.1:7897'
 *    SOCKS5代理: 需要使用 socks-proxy-agent 包
 * 
 * 7. 环境变量配置（推荐）：
 *    创建 .env 文件：
 *    PRIVATE_KEY=your_private_key_here
 *    PROXY_URL=http://127.0.0.1:7897
 *    PROXY_ENABLED=true
 * 
 * 8. API文档：
 *    https://www.okx.com/web3/build/docs/waas/dex-introduction
 * 
 * 9. 其他链支持：
 *    修改 CONFIG.CHAIN_ID 即可：
 *    - Ethereum: 1
 *    - Polygon: 137
 *    - Arbitrum: 42161
 *    - Optimism: 10
 */