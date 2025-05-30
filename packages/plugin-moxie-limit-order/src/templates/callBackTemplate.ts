
export const INVALID_TRANSACTION_STRUCTURE = (reason: string) => {
    return {
        text: "\nInvalid transaction structure. Please try again with a valid transaction request.",
        content: {
            error: "INVALID_CONTENT",
            details: reason,
            action: "TOKEN_TRANSFER"
        }
    }
}

export const APPLICATION_ERROR = (error: string) => {
    return {
        text: "\nAn error occurred while processing the transaction. Please try again.",
        content: {
            error: "APPLICATION_ERROR",
            details: error,
            action: "LIMIT_ORDERS"
        }
    }
}

export const APPLICATION_ERROR_WITH_ERR_MESSAGE = (error: string) => {
    return {
        text: error,
        content: {
            action: "LIMIT_ORDERS"
        }
    }
}

export const CREATOR_NOT_FOUND = (creatorId: string) => {
    return {
        text: `\nUnfortunately, the user you are querying has not launched a creator coin yet. Creator coins are required to analyze user data using the Senpi AI Agent. Please try again`,
    }
}

export const INSUFFICIENT_BALANCE = (tokenSymbol: string, currentBalance: string, requiredBalance: string) => {
    return {
        text: `\nInsufficient balance in your agent wallet to complete this transaction. \nCurrent balance: ${currentBalance} ${tokenSymbol}\nRequired balance: ${requiredBalance} ${tokenSymbol}. Please add more funds to your agent wallet and try again.`,
    }
}

export const INSUFFICIENT_BALANCE_GENERIC = (tokenSymbol: string) => {
    return {
        text: `\nInsufficient ${tokenSymbol} balance in your agent wallet to complete this transaction. \nPlease add more funds and try again.`,
    }
}

export const LIMIT_ORDER_SUCCESSFUL = (orderId: string, isAlertsNotEnabled: boolean) => {
    return {
        text: `\nLimit order created successfully.${isAlertsNotEnabled ? '\n💥 Important: set up alerts for when the trade executes or expires!' : ''}`,
        cta: isAlertsNotEnabled ? ["SETUP_ALERTS", "GO_TO_LIMIT_ORDERS"] : "GO_TO_LIMIT_ORDERS",
        content: {
            action: "LIMIT_ORDERS",
            orderId: orderId
        }
    }
}

export const INSUFFICIENT_LIQUIDITY = (sellTokenSymbol: string, buyTokenSymbol: string) => {
    return {
        text: `\nInsufficient liquidity to complete this transaction. Please try with a smaller amount.`,
        content: {
            action: "LIMIT_ORDERS",
        }
    }
}
