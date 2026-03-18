const { Web3 } = require('web3');
const axios = require('axios');
const dotenv = require('dotenv');
const CryptoJS = require('crypto-js');

// 加载环境变量
dotenv.config();

// 连接到Base网络
const web3 = new Web3(process.env.EVM_RPC_URL);

// 您的钱包信息 - 替换为您自己的值
const WALLET_ADDRESS = process.env.EVM_WALLET_ADDRESS || '';
const PRIVATE_KEY = process.env.EVM_PRIVATE_KEY || '';

const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'; // 原生ETH
const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC on ETH
const USDT_ADDRESS = '0xdac17f958d2ee523a2206206994597c13d831ec7'; // USDD on ETH

const dexApproveAddress = '0x40aA958dd87FC8305b97f2BA922CDdCa374bcD7f'; // 
const dexRouterAddress = '0x5E1f62Dac767b0491e3CE72469C217365D5B48cC';      // 

const chainIndex = '1';

// API URL
const baseUrl = 'https://web3.okx.com/api/v6/';

// 定义接口（在JS中不需要显式定义）

/**
 * 生成API认证头信息
 */
function getHeaders(timestamp, method, requestPath, queryString = "", body = "") {
    const apiKey = process.env.OKX_API_KEY;
    const secretKey = process.env.OKX_SECRET_KEY;
    const apiPassphrase = process.env.OKX_API_PASSPHRASE;

    if (!apiKey || !secretKey || !apiPassphrase) {
        throw new Error("API认证所需的环境变量缺失");
    }

    const stringToSign = timestamp + method + requestPath + (queryString || body);

    return {
        "Content-Type": "application/json",
        "OK-ACCESS-KEY": apiKey,
        "OK-ACCESS-SIGN": CryptoJS.enc.Base64.stringify(
            CryptoJS.HmacSHA256(stringToSign, secretKey)
        ),
        "OK-ACCESS-TIMESTAMP": timestamp,
        "OK-ACCESS-PASSPHRASE": apiPassphrase,
    };
}

/**
 * 检查代币授权额度
 * @param {string} tokenAddress - 代币合约地址
 * @param {string} ownerAddress - 您的钱包地址
 * @param {string} spenderAddress - DEX合约地址（授权对象）
 * @returns {Promise<bigint>} 授权额度
 */
async function checkAllowance(tokenAddress, ownerAddress, spenderAddress) {
  const tokenABI = [
    {
      "constant": true,
      "inputs": [
        { "name": "_owner", "type": "address" },
        { "name": "_spender", "type": "address" }
      ],
      "name": "allowance",
      "outputs": [{ "name": "", "type": "uint256" }],
      "payable": false,
      "stateMutability": "view",
      "type": "function"
    }
  ];

  const tokenContract = new web3.eth.Contract(tokenABI, tokenAddress);
  try {
    const allowance = await tokenContract.methods.allowance(ownerAddress, spenderAddress).call();
    return BigInt(String(allowance));
  } catch (error) {
    console.error('查询授权额度失败:', error);
    throw error;
  }
}

/**
 * 获取授权交易数据
 * @param {string} tokenAddress - 代币合约地址
 * @param {string} amount - 授权金额
 * @returns {Promise<any>} 授权交易数据
 */
async function getApproveTransaction(tokenAddress, amount) {
  try {
    const path = 'dex/aggregator/approve-transaction';
    const url = `${baseUrl}${path}`;
    const params = {
      chainIndex: chainIndex,
      tokenContractAddress: tokenAddress,
      approveAmount: amount
    };

    // 准备认证信息
    const timestamp = new Date().toISOString();
    const requestPath = `/api/v6/${path}`;
    const queryString = "?" + new URLSearchParams(params).toString();
    const headers = getHeaders(timestamp, 'GET', requestPath, queryString);

    const response = await axios.get(url, { params, headers });

    if (response.data.code === '0') {
      return response.data.data[0];
    } else {
      throw new Error(`API错误: ${response.data.msg || '未知错误'}`);
    }
  } catch (error) {
    console.error('获取授权交易数据失败:', error.message);
    throw error;
  }
}

/**
 * 从DEX API获取兑换报价
 * @param {string} fromTokenAddress - 源代币地址
 * @param {string} toTokenAddress - 目标代币地址
 * @param {string} amount - 兑换金额
 * @param {string} slippagePercent - 最大滑点百分比（例如 "0.5" 表示 0.5%）
 * @returns {Promise<any>} 兑换报价
 */
async function getSwapQuote(fromTokenAddress, toTokenAddress, amount, slippagePercent = '0.5') {
  try {
    const path = 'dex/aggregator/quote';
    const url = `${baseUrl}${path}`;

    const params = {
      chainIndex: chainIndex,
      fromTokenAddress,
      toTokenAddress,
      amount,
      slippagePercent
    };

    // 准备认证信息
    const timestamp = new Date().toISOString();
    const requestPath = `/api/v6/${path}`;
    const queryString = "?" + new URLSearchParams(params).toString();
    const headers = getHeaders(timestamp, 'GET', requestPath, queryString);

    const response = await axios.get(url, { params, headers });

    if (response.data.code === '0') {
      return response.data.data[0];
    } else {
      throw new Error(`API错误: ${response.data.msg || '未知错误'}`);
    }
  } catch (error) {
    console.error('获取兑换报价失败:', error.message);
    throw error;
  }
}

/**
 * 从Onchain gateway API获取交易Gas限制
 * @param {string} fromAddress - 发送方地址
 * @param {string} toAddress - 目标合约地址
 * @param {string} txAmount - 交易金额（授权时为0）
 * @param {string} inputData - 交易calldata
 * @returns {Promise<string>} 预估的Gas限制
 */
async function getGasLimit(fromAddress, toAddress, txAmount = '0', inputData = '') {
    try {
        console.log('正在从Onchain Gateway API获取Gas限制...');
        
        const path = 'dex/pre-transaction/gas-limit';
        const url = `${baseUrl}${path}`;

        const body = {
            chainIndex: chainIndex,
            fromAddress: fromAddress,
            toAddress: toAddress,
            txAmount: txAmount,
            extJson: {
                inputData: inputData
            }
        };

        // 准备认证信息，包含body签名
        const bodyString = JSON.stringify(body);
        const timestamp = new Date().toISOString();
        const requestPath = `/api/v6/${path}`;
        const headers = getHeaders(timestamp, 'POST', requestPath, "", bodyString);

        const response = await axios.post(url, body, { headers });

        console.log('Gas限制API响应:');
        console.log(JSON.stringify(response.data, null, 2));

        if (response.data.code === '0') {
            const gasLimit = response.data.data[0].gasLimit;
            console.log(`获取到的Gas限制: ${gasLimit}`);
            return gasLimit;
        } else {
            throw new Error(`API错误: ${response.data.msg || '未知错误'}`);
        }
    } catch (error) {
        console.error('获取Gas限制失败:', error.message);
        throw error;
    }
}

/**
 * 从OKX API获取兑换数据
 */
async function getSwapData(fromTokenAddress, toTokenAddress, amount, slippagePercent = '0.5') {
    try {
        console.log('正在从OKX API获取兑换数据...');
        
        const path = 'dex/aggregator/swap';
        const url = `${baseUrl}${path}`;

        const params = {
            chainIndex: chainIndex,
            fromTokenAddress: fromTokenAddress,
            toTokenAddress: toTokenAddress,
            amount: amount,
            slippagePercent: slippagePercent,
            userWalletAddress: WALLET_ADDRESS
        };

        console.log('兑换API请求参数:');
        console.log(JSON.stringify(params, null, 2));

        // 准备认证信息，包含查询字符串
        const queryString = "?" + new URLSearchParams(params).toString();
        const timestamp = new Date().toISOString();
        const requestPath = `/api/v6/${path}`;
        const headers = getHeaders(timestamp, 'GET', requestPath, queryString);

        const response = await axios.get(`${url}${queryString}`, { headers });

        console.log('兑换API响应:');
        console.log(JSON.stringify(response.data, null, 2));

        const responseData = response.data;
        if (responseData.code === '0') {
            return responseData.data[0];
        } else {
            throw new Error(`兑换API错误: ${responseData.msg || '未知错误'}`);
        }
    } catch (error) {
        console.error('获取兑换数据失败:', error.message);
        throw error;
    }
}

/**
 * 使用Onchain Gateway API模拟交易
 */
async function simulateTransaction(swapData) {
    try {
        console.log('正在使用Onchain Gateway API模拟交易...');
        
        const path = 'dex/pre-transaction/simulate';
        const url = `${baseUrl}${path}`;

        const body = {
            chainIndex: chainIndex,
            fromAddress: swapData.tx.from,
            toAddress: swapData.tx.to,
            txAmount: swapData.tx.value || '0',
            extJson: {
                inputData: swapData.tx.data
            }
        };

        // 准备认证信息，包含body签名
        const bodyString = JSON.stringify(body);
        const timestamp = new Date().toISOString();
        const requestPath = `/api/v6/${path}`;
        const headers = getHeaders(timestamp, 'POST', requestPath, "", bodyString);

        const response = await axios.post(url, body, { headers });

        console.log('模拟API响应:');
        console.log(JSON.stringify(response.data, null, 2));

        if (response.data.code === '0') {
            const simulationResult = response.data.data[0];
            // 检查模拟是否成功（无failReason或failReason为空）
            if (!simulationResult.failReason || simulationResult.failReason === '') {
                console.log(`交易模拟成功。Gas使用量: ${simulationResult.gasUsed}`);
                return simulationResult;
            } else {
                throw new Error(`模拟失败: ${simulationResult.failReason}`);
            }
        } else {
            throw new Error(`模拟API错误: ${response.data.msg || '未知错误'}`);
        }
    } catch (error) {
        console.error('交易模拟失败:', error.message);
        throw error;
    }
}

/**
 * 使用Onchain Gateway API广播交易，带RPC回退
 */
async function broadcastTransaction(signedTx, chainIndex, walletAddress) {
    try {
        console.log('正在通过Onchain Gateway API广播交易...');
        
        const path = 'dex/pre-transaction/broadcast-transaction';
        const url = `${baseUrl}${path}`;

        // 将rawTransaction转换为十六进制字符串
        const rawTxHex = typeof signedTx.rawTransaction === 'string' 
            ? signedTx.rawTransaction 
            : web3.utils.bytesToHex(signedTx.rawTransaction);

        const body = {
            signedTx: rawTxHex,
            chainIndex: chainIndex,
            address: walletAddress
            // 有关MEV保护设置，请参阅[MEV部分](#10-mev-protection)
        };

        console.log('广播API请求体:');
        console.log(JSON.stringify(body, null, 2));

        // 准备认证信息，包含body签名
        const bodyString = JSON.stringify(body);
        const timestamp = new Date().toISOString();
        const requestPath = `/api/v6/${path}`;
        const headers = getHeaders(timestamp, 'POST', requestPath, "", bodyString);

        const response = await axios.post(url, body, { headers });

        console.log('广播API响应:');
        console.log(JSON.stringify(response.data, null, 2));

        if (response.data.code === '0') {
            const orderId = response.data.data[0].orderId;
            console.log(`交易广播成功。订单ID: ${orderId}`);
            return orderId;
        } else {
            throw new Error(`广播API错误: ${response.data.msg || '未知错误'}`);
        }
    } catch (error) {
        console.error('API广播失败，尝试RPC回退:', error.message);
        
        // 回退到RPC广播
        try {
            console.log('正在通过RPC回退广播...');
            const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
            console.log(`RPC广播成功。交易哈希: ${receipt.transactionHash}`);
            return receipt.transactionHash.toString();
        } catch (rpcError) {
            console.error('RPC广播也失败:', rpcError.message);
            throw new Error(`API和RPC广播均失败。API错误: ${error.message}，RPC错误: ${rpcError.message}`);
        }
    }
}

/**
 * 执行完整的兑换交易流程
 */
async function executeSwap(fromTokenAddress, toTokenAddress, amount, slippagePercent = '0.5') {
    try {
        console.log('开始执行兑换...');
        // 步骤1：获取兑换数据
        const swapData = await getSwapData(fromTokenAddress, toTokenAddress, amount, slippagePercent);
        console.log('已获取兑换数据');

        // 步骤2：模拟交易
        // const simulationResult = await simulateTransaction(swapData);
        // console.log('交易模拟完成');
        // console.log('模拟结果', simulationResult.intention);

        // 步骤3：获取Gas限制
        const gasLimit = await getGasLimit(
            swapData.tx.from,
            swapData.tx.to,
            swapData.tx.value || '0',
            swapData.tx.data
        );

        // 步骤4：获取当前Gas价格
        const gasPrice = await web3.eth.getGasPrice();
        console.log(`当前Gas价格: ${web3.utils.fromWei(gasPrice, 'gwei')} gwei`);

        // 步骤5：获取nonce
        const nonce = await web3.eth.getTransactionCount(WALLET_ADDRESS, 'pending');
        console.log(`Nonce: ${nonce}`);

        // 步骤6：构建交易
        const transaction = {
            from: swapData.tx.from,
            to: swapData.tx.to,
            data: swapData.tx.data,
            value: swapData.tx.value || '0x0',
            gas: gasLimit,
            gasPrice: gasPrice.toString(),
            nonce: Number(nonce),
            chainIndex: parseInt(chainIndex)
        };

        console.log('交易对象:');
        console.log(JSON.stringify(transaction, null, 2));

        // 步骤7：签名交易
        console.log('正在签名交易...');
        const signedTx = await web3.eth.accounts.signTransaction(transaction, PRIVATE_KEY);
        console.log('交易签名完成');

        // 步骤8：广播交易
        const txHash = await broadcastTransaction(signedTx, chainIndex, WALLET_ADDRESS);
        console.log(`交易广播成功。哈希: ${txHash}`);

        // 步骤9：跟踪交易
        console.log('正在跟踪交易状态...');
        const trackingResult = await trackTransaction(txHash);
        console.log('交易跟踪完成');
        console.log('跟踪结果', trackingResult);

        return txHash;
    } catch (error) {
        console.error('兑换执行失败:', error.message);
        throw error;
    }
}

/**
 * 执行带模拟的兑换交易，带详细日志
 */
async function executeSwapWithSimulation(fromTokenAddress, toTokenAddress, amount, slippagePercent = '0.5') {
    try {
        console.log('开始执行带模拟的兑换...');
        
        const txHash = await executeSwap(fromTokenAddress, toTokenAddress, amount, slippagePercent);
        
        console.log('兑换执行成功完成！');
        console.log(`交易哈希: ${txHash}`);
        
        return { success: true, txHash };
    } catch (error) {
        console.error('兑换执行失败:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * 使用Onchain gateway API跟踪交易确认状态
 * @param {string} orderId - 广播响应中的订单ID
 * @param {number} intervalMs - 轮询间隔（毫秒）
 * @param {number} timeoutMs - 最长等待时间
 * @returns {Promise<any>} 最终交易确认状态
 */
async function trackTransaction(orderId, intervalMs = 5000, timeoutMs = 300000) {
    console.log(`正在跟踪订单ID的交易状态: ${orderId}`);

    const startTime = Date.now();
    let lastStatus = '';

    while (Date.now() - startTime < timeoutMs) {
        try {
            const path = 'dex/post-transaction/orders';
            const url = `https://web3.okx.com/api/v6/${path}`;

            const params = {
                orderId: orderId,
                chainIndex: chainIndex,
                address: WALLET_ADDRESS,
                limit: '1'
            };

            const timestamp = new Date().toISOString();
            const requestPath = `/api/v6/${path}`;
            const queryString = "?" + new URLSearchParams(params).toString();
            const headers = getHeaders(timestamp, 'GET', requestPath, queryString);

            const response = await axios.get(url, { params, headers });

            const responseData = response.data;
            if (responseData.code === '0' && responseData.data && responseData.data.length > 0) {
                if (responseData.data[0].orders && responseData.data[0].orders.length > 0) {
                    const txData = responseData.data[0].orders[0];
                    const status = txData.txStatus;

                    if (status !== lastStatus) {
                        lastStatus = status;

                        if (status === '1') {
                            console.log(`交易待处理: ${txData.txHash || '哈希尚不可用'}`);
                        } else if (status === '2') {
                            console.log(`交易成功: https://web3.okx.com/explorer/base/tx/${txData.txHash}`);
                            return txData;
                        } else if (status === '3') {
                            const failReason = txData.failReason || '未知原因';
                            const errorMessage = `交易失败: ${failReason}`;

                            console.error(errorMessage);

                            const errorInfo = handleTransactionError(txData);
                            console.log(`错误类型: ${errorInfo.error}`);
                            console.log(`建议操作: ${errorInfo.action}`);

                            throw new Error(errorMessage);
                        }
                    }
                } else {
                    console.log(`未找到订单ID的订单: ${orderId}`);
                }
            }
        } catch (error) {
            console.warn('检查交易状态时出错:', error.message);
        }

        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    throw new Error('交易跟踪超时');
}

/**
 * 全面的错误处理，包含失败原因
 * @param {any} txData - 来自post-transaction/orders的交易数据
 * @returns {Object} 结构化的错误信息
 */
function handleTransactionError(txData) {
    const failReason = txData.failReason || '未知原因';

    console.error(`交易失败，原因: ${failReason}`);

    return {
        error: 'TRANSACTION_FAILED',
        message: failReason,
        action: '请重试或联系支持'
    };
}

// ======== 主执行函数 ========

async function simulateOnly(fromTokenAddress, toTokenAddress, amount, slippagePercent = '0.5') {
    try {
        console.log('开始仅模拟模式...');
        console.log(`模拟详情:`);
        console.log(`   从代币: ${fromTokenAddress}`);
        console.log(`   到代币: ${toTokenAddress}`);
        console.log(`   金额: ${amount}`);
        console.log(`   滑点百分比: ${slippagePercent}%`);

        // 步骤1：获取兑换数据
        const swapData = await getSwapData(fromTokenAddress, toTokenAddress, amount, slippagePercent);
        console.log('已获取兑换数据');

        // 步骤2：模拟交易
        const simulationResult = await simulateTransaction(swapData);
        console.log('交易模拟完成');

        // 步骤3：获取Gas限制
        const gasLimit = await getGasLimit(
            swapData.tx.from,
            swapData.tx.to,
            swapData.tx.value || '0',
            swapData.tx.data
        );

        return {
            success: true,
            swapData,
            simulationResult,
            gasLimit,
            estimatedGasUsed: simulationResult.gasUsed,
        };
    } catch (error) {
        console.error('模拟失败:', error.message);
        return { success: false, error: error.message };
    }
}

async function main() {
    try {
        console.log('EVM兑换工具 - Onchain Gateway API');
        console.log('=====================================');

        // 验证环境变量
        if (!WALLET_ADDRESS || !PRIVATE_KEY) {
            throw new Error('环境变量中缺少钱包地址或私钥');
        }

        console.log(`钱包地址: ${WALLET_ADDRESS}`);
        console.log(`链ID: ${chainIndex}`);
        console.log(`RPC URL: ${process.env.EVM_RPC_URL}`);

        // 解析命令行参数
        const args = process.argv.slice(2);
        const mode = args[0] || 'simulate'; // 默认为模拟模式
        
        // 示例参数
        // const fromToken = ETH_ADDRESS;
        // const toToken = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // Base上的USDC
        // const amount = '100000000000000'; // 0.0001 ETH（以wei为单位）
        // const slippagePercent = '0.5'; // 0.5%
        const fromToken = USDC_ADDRESS;
        const toToken = USDT_ADDRESS; 
        const amount = '1000000'; // 1 USDC
        const slippagePercent = '1'; // 1%

        console.log('\n配置:');
        console.log(`   从: ${fromToken} (ETH)`);
        console.log(`   到: ${toToken} (USDC)`);
        console.log(`   金额: ${web3.utils.fromWei(amount, 'ether')} ETH`);
        console.log(`   滑点百分比: ${slippagePercent}%`);
        console.log(`   模式: ${mode}`);

        // get allowance
        // let allowance1 = await checkAllowance(fromToken, WALLET_ADDRESS, dexApproveAddress)
        // let allowance2 = await checkAllowance(fromToken, WALLET_ADDRESS, dexRouterAddress)
        // console.log(`allowance to dex approvce is ${dexApproveAddress} ${allowance1}`)
        // console.log(`allowance to dex router is ${dexRouterAddress} ${allowance2}`)

        // approve 
        // let approveTransaction = await getApproveTransaction(fromToken, amount)
        // console.log(`approveTransaction ${JSON.stringify(approveTransaction, null, 2)}`)
        // approveTransaction {
        //   "data": "0x095ea7b300000000000000000000000040aa958dd87fc8305b97f2ba922cddca374bcd7f00000000000000000000000000000000000000000000000000000000000f4240",
        //   "dexContractAddress": "0x40aA958dd87FC8305b97f2BA922CDdCa374bcD7f",
        //   "gasLimit": "70000",
        //   "gasPrice": "84765291"
        // }

        let result;
        
        switch (mode.toLowerCase()) {
            case 'simulate':
            case 'sim':
                result = await simulateOnly(fromToken, toToken, amount, slippagePercent);
                break;
            case 'execute':
            case 'exec':
                result = await executeSwapWithSimulation(fromToken, toToken, amount, slippagePercent);
                break;
            default:
                console.log('\n可用模式:');
                console.log('   simulate/sim  - 仅模拟交易');
                console.log('   execute/exec  - 执行完整兑换');
                console.log('\n示例: npm run evm-swap simulate');
                return;
        }
        
        if (result.success) {
            console.log('\n操作成功完成！');
            if (mode === 'simulate' || mode === 'sim') {
                console.log(`Gas限制: ${result.gasLimit}`);
            } else {
                console.log(`交易哈希: ${result.txHash}`);
            }
        } else {
            console.log('\n操作失败！');
            console.log(`错误: ${result.error}`);
        }
    } catch (error) {
        console.error('主执行失败:', error.message);
        process.exit(1);
    }
}

// 运行脚本
if (require.main === module) {
    main();
}

module.exports = {
    executeSwap,
    executeSwapWithSimulation,
    simulateOnly,
    getSwapData,
    simulateTransaction,
    getGasLimit,
    broadcastTransaction,
    trackTransaction
};

/**
/home/jsw/.nvm/versions/node/v22.21.1/bin/node ./okx-swap.js execute
[dotenv@17.2.3] injecting env (0) from .env -- tip: ⚙️  specify custom .env file path with { path: '/custom/path/.env' }
EVM兑换工具 - Onchain Gateway API
=====================================
钱包地址: 0x34aabb238177ef195ed90fea056edd6648732014
链ID: 1
RPC URL: https://ethereum-rpc.publicnode.com

配置:
   从: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 (ETH)
   到: 0xdac17f958d2ee523a2206206994597c13d831ec7 (USDC)
   金额: 0.000000000001 ETH
   滑点百分比: 1%
   模式: execute
开始执行带模拟的兑换...
开始执行兑换...
正在从OKX API获取兑换数据...
兑换API请求参数:
{
  "chainIndex": "1",
  "fromTokenAddress": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "toTokenAddress": "0xdac17f958d2ee523a2206206994597c13d831ec7",
  "amount": "1000000",
  "slippagePercent": "1",
  "userWalletAddress": "0x34aabb238177ef195ed90fea056edd6648732014"
}
兑换API响应:
{
  "code": "0",
  "data": [
    {
      "routerResult": {
        "chainIndex": "1",
        "contextSlot": 24682151,
        "dexRouterList": [
          {
            "dexProtocol": {
              "dexName": "DODO V2",
              "percent": "100"
            },
            "fromToken": {
              "decimal": "6",
              "isHoneyPot": false,
              "taxRate": "0",
              "tokenContractAddress": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
              "tokenSymbol": "USDC",
              "tokenUnitPrice": "0.99991"
            },
            "fromTokenIndex": "0",
            "toToken": {
              "decimal": "6",
              "isHoneyPot": false,
              "taxRate": "0",
              "tokenContractAddress": "0xdac17f958d2ee523a2206206994597c13d831ec7",
              "tokenSymbol": "USDT",
              "tokenUnitPrice": "1.0003"
            },
            "toTokenIndex": "1"
          }
        ],
        "estimateGasFee": "273000",
        "fromToken": {
          "decimal": "6",
          "isHoneyPot": false,
          "taxRate": "0",
          "tokenContractAddress": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
          "tokenSymbol": "USDC",
          "tokenUnitPrice": "0.99991"
        },
        "fromTokenAmount": "1000000",
        "priceImpactPercent": "0.01",
        "router": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48--0xdac17f958d2ee523a2206206994597c13d831ec7",
        "swapMode": "exactIn",
        "toToken": {
          "decimal": "6",
          "isHoneyPot": false,
          "taxRate": "0",
          "tokenContractAddress": "0xdac17f958d2ee523a2206206994597c13d831ec7",
          "tokenSymbol": "USDT",
          "tokenUnitPrice": "1.0003"
        },
        "toTokenAmount": "999701",
        "tradeFee": "0.04465614410812464"
      },
      "tx": {
        "data": "0xf2c426960000000000000000000000000000000000000000000000000000000000035418000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec700000000000000000000000000000000000000000000000000000000000f424000000000000000000000000000000000000000000000000000000000000f1a070000000000000000000000000000000000000000000000000000000069ba401f00000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000000160000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000000000000000000000000000000000000000000100000000000000000000000056bd269db96a089295d742351ba459fb0c279fe2000000000000000000000000000000000000000000000000000000000000000100000000000000000000000004571c32a4e1c5f39bc3a238cb95b215058c432c000000000000000000000000000000000000000000000000000000000000000180000000000000000001271004571c32a4e1c5f39bc3a238cb95b215058c432c000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000077777777111180000000000000000000000000000000000000000000000f4115777777771111000000000064fa00a9ed787f3793db668bff3e6e6e7db0f92a1b",
        "from": "0x34aabb238177ef195ed90fea056edd6648732014",
        "gas": "273000",
        "gasPrice": "116860893",
        "maxPriorityFeePerGas": "72177741",
        "maxSpendAmount": "",
        "minReceiveAmount": "989703",
        "signatureData": [
          ""
        ],
        "slippagePercent": "1",
        "to": "0x5E1f62Dac767b0491e3CE72469C217365D5B48cC",
        "value": "0"
      }
    }
  ],
  "msg": ""
}
已获取兑换数据
正在从Onchain Gateway API获取Gas限制...
Gas限制API响应:
{
  "code": "0",
  "msg": "success",
  "data": [
    {
      "gasLimit": "228051"
    }
  ]
}
获取到的Gas限制: 228051
当前Gas价格: 0.036685467 gwei
Nonce: 50
交易对象:
{
  "from": "0x34aabb238177ef195ed90fea056edd6648732014",
  "to": "0x5E1f62Dac767b0491e3CE72469C217365D5B48cC",
  "data": "0xf2c426960000000000000000000000000000000000000000000000000000000000035418000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec700000000000000000000000000000000000000000000000000000000000f424000000000000000000000000000000000000000000000000000000000000f1a070000000000000000000000000000000000000000000000000000000069ba401f00000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000000160000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000000000000000000000000000000000000000000100000000000000000000000056bd269db96a089295d742351ba459fb0c279fe2000000000000000000000000000000000000000000000000000000000000000100000000000000000000000004571c32a4e1c5f39bc3a238cb95b215058c432c000000000000000000000000000000000000000000000000000000000000000180000000000000000001271004571c32a4e1c5f39bc3a238cb95b215058c432c000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000077777777111180000000000000000000000000000000000000000000000f4115777777771111000000000064fa00a9ed787f3793db668bff3e6e6e7db0f92a1b",
  "value": "0",
  "gas": "228051",
  "gasPrice": "36685467",
  "nonce": 50,
  "chainIndex": 1
}
正在签名交易...
交易签名完成
正在通过Onchain Gateway API广播交易...
广播API请求体:
{
  "signedTx": "0xf903aa3284022fc69b83037ad3945e1f62dac767b0491e3ce72469c217365d5b48cc80b90344f2c426960000000000000000000000000000000000000000000000000000000000035418000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec700000000000000000000000000000000000000000000000000000000000f424000000000000000000000000000000000000000000000000000000000000f1a070000000000000000000000000000000000000000000000000000000069ba401f00000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000000160000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000000000000000000000000000000000000000000100000000000000000000000056bd269db96a089295d742351ba459fb0c279fe2000000000000000000000000000000000000000000000000000000000000000100000000000000000000000004571c32a4e1c5f39bc3a238cb95b215058c432c000000000000000000000000000000000000000000000000000000000000000180000000000000000001271004571c32a4e1c5f39bc3a238cb95b215058c432c000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000077777777111180000000000000000000000000000000000000000000000f4115777777771111000000000064fa00a9ed787f3793db668bff3e6e6e7db0f92a1b25a0ef41fd99a2117b3404fdf8c6898f4856d3e3cef0f46968bccb44dca02f4d21faa0693fa402ccf7bf989ef3588487ecfa01f095a7bda91d90e3064ee5453faeb760",
  "chainIndex": "1",
  "address": "0x34aabb238177ef195ed90fea056edd6648732014"
}
广播API响应:
{
  "code": "0",
  "msg": "success",
  "data": [
    {
      "orderId": "16cd5eefceca5cc0169250925f46cbccfbf662ea",
      "txHash": "0xd08da657fb651e2eb4c67cad43747880ff6d59725c79767a2fd1de32bb7aba0d"
    }
  ]
}
交易广播成功。订单ID: 16cd5eefceca5cc0169250925f46cbccfbf662ea
交易广播成功。哈希: 16cd5eefceca5cc0169250925f46cbccfbf662ea
正在跟踪交易状态...
正在跟踪订单ID的交易状态: 16cd5eefceca5cc0169250925f46cbccfbf662ea
交易待处理: 0xd08da657fb651e2eb4c67cad43747880ff6d59725c79767a2fd1de32bb7aba0d
交易成功: https://web3.okx.com/explorer/base/tx/0xd08da657fb651e2eb4c67cad43747880ff6d59725c79767a2fd1de32bb7aba0d
交易跟踪完成
跟踪结果 {chainIndex: '1', address: '0x34aabb238177ef195ed90fea056edd6648732014', orderId: '16cd5eefceca5cc0169250925f46cbccfbf662ea', txStatus: '2', failReason: '', …}
兑换执行成功完成！
交易哈希: 16cd5eefceca5cc0169250925f46cbccfbf662ea

操作成功完成！
交易哈希: 16cd5eefceca5cc0169250925f46cbccfbf662ea


 */