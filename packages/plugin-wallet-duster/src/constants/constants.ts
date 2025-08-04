import { GetQuoteResponse } from "../types";

export const ETH_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
export const ETH_SYMBOL = "ETH";
export const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
export const ETH_TOKEN_DECIMALS = 18;
export const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const USDC_TOKEN_DECIMALS = 6;
export const USDC = "USDC";
export const MOXIE = "MOXIE";
export const MOXIE_TOKEN_ADDRESS = process.env.MOXIE_TOKEN_ADDRESS;
export const MOXIE_TOKEN_DECIMALS = 18;
export const TRANSACTION_RECEIPT_TIMEOUT = 60000;
export const subjectSharePurchasedTopic0 =
    "0x96c1b5a0ee3c1932c831b8c6a559c93b48a3109915784a05ff44a07cc09c3931";
export const subjectShareSoldTopic0 =
    "0x44ebb8a56b0413525e33cc89179d9758b2b1ab944b0bbeeb6d119adb2a6e3fe2";
export const ERC20_TXN_SLIPPAGE_BPS = 100; // 1% slippage (100 basis points = 1%)
export const BASE_NETWORK_ID = 8453;
export const MAX_UINT256 = BigInt(
    "115792089237316195423570985008687907853269984665640564039457584007913129639935"
); // Maximum uint256 value for unlimited approval
export const INITIAL_SLIPPAGE_IN_BPS = Number(
    process.env.INITIAL_SLIPPAGE_IN_BPS || 100
); // 1%
export const SLIPPAGE_INCREMENT_PER_RETRY_IN_BPS = Number(
    process.env.SLIPPAGE_INCREMENT_PER_RETRY_IN_BPS || 200
); // 2%
export const SWAP_RETRY_COUNT = Number(process.env.SWAP_RETRY_COUNT || 5);
export const SWAP_RETRY_DELAY = Number(process.env.SWAP_RETRY_DELAY || 1000); // 1 second

export const ERC20_ABI = [
    {
        constant: false,
        inputs: [
            {
                name: "_spender",
                type: "address",
            },
            {
                name: "_value",
                type: "uint256",
            },
        ],
        name: "approve",
        outputs: [
            {
                name: "",
                type: "bool",
            },
        ],
        payable: false,
        stateMutability: "nonpayable",
        type: "function",
    },
    {
        constant: true,
        inputs: [
            {
                name: "_owner",
                type: "address",
            },
            {
                name: "_spender",
                type: "address",
            },
        ],
        name: "allowance",
        outputs: [
            {
                name: "",
                type: "uint256",
            },
        ],
        payable: false,
        stateMutability: "view",
        type: "function",
    },
    {
        constant: false,
        inputs: [
            {
                name: "_to",
                type: "address",
            },
            {
                name: "_value",
                type: "uint256",
            },
        ],
        name: "transfer",
        outputs: [
            {
                name: "",
                type: "bool",
            },
        ],
        payable: false,
        stateMutability: "nonpayable",
        type: "function",
    },
];

export const mockGetQuoteResponse: GetQuoteResponse = {
    blockNumber: "1",
    buyAmount: "1",
    buyToken: "1",
    sellAmount: "1",
    sellToken: "1",
    minBuyAmount: "1",
    liquidityAvailable: true,
    totalNetworkFee: "1",
    zid: "1",
    fees: {
        zeroExFee: {
            amount: "1",
            token: "1",
            type: "1",
        },
        integratorFee: {
            amount: "1",
            token: "1",
            type: "1",
        },
        gasFee: {
            amount: "1",
            token: "1",
            type: "1",
        },
    },
    issues: {
        allowance: null,
        balance: {
            token: "1",
            actual: "1",
            expected: "1",
        },
        simulationIncomplete: false,
        invalidSourcesPassed: [],
    },
    permit2: {
        type: "Permit2",
        hash: "1",
        eip712: {
            types: {},
            domain: {},
            message: {},
            primaryType: "1",
        },
    },
    route: {
        fills: [],
        tokens: [],
    },
    tokenMetadata: {
        buyToken: {
            buyTaxBps: "1",
            sellTaxBps: "1",
        },
        sellToken: {
            buyTaxBps: "1",
            sellTaxBps: "1",
        },
    },
    transaction: {
        to: "1",
        data: "1",
        gas: "1",
        gasPrice: "1",
        value: "1",
    },
};
