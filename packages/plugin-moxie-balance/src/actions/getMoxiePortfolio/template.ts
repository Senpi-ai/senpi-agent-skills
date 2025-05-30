const tokenOutputTemplate = `
Show a table of tokens from portfolio.tokenBalances.node with:
- Token Symbol in the first column. For this column, use the token symbol with its associated token address prefixed by $ using the exact markdown format: $[tokenSymbol|tokenAddress] format e.g. $[WETH|0x4200000000000000000000000000000000000006].
- Amount and USD values
- Sort by USD value (highest first)
- Only include if balanceUSD > $0.01
- show holdingPercentage for % of Holdings
- Limit to top 15 holdings or more if asked in Analyze my portfolio.]
- Show contract address for each token. For this column, only show the token address.
`;

const commonTokenOutputTemplate = `
| Token | 'user1' (Amount) | 'user2' (Amount) |  'user1' (USD) |  'user2' (USD) |
|-------|--------------|---------------|----------------|----------------|
[For each row in filteredCommonFanTokenHoldings:
- Show row.displayLabel in the first column. For this column, use row.displayLabel with its associated token address prefixed by $ using the exact markdown format: $[row.displayLabel|tokenAddress] format e.g. $[WETH|0x4200000000000000000000000000000000000006].
- Show row[user1].amount in the second column.
- Show row[user2].amount in the third column.
- Show row[user1].dollarValue in the fourth column.
- Show row[user2].dollarValue in the fifth column.
- similar to this build column for all users in filteredCommonFanTokenHoldings
]
`;

export const mutiplePortfolioSummary = `

You are summarizing portfolio holdings for a user. Add details about the user from the message.

Try to answer in the following sequence:


1. Check if {{portfolioSummaries}} is present answer from these details and stop here, Try to answer the question asked in {{message}} with these details:
   - If yes, use only these to generate the summary and stop here.
   - Here, one item in the list portfolioSummaries belongs to one user.
   - Provide details about the tokens as "Token Holdings" and app balances as "Creator Coin Holdings" common in portfolioSummaries in tabular form similar to # Token Holdings ${tokenOutputTemplate}.
   - Provide details about common holdings in {{filteredCommonTokenHoldings}} for Tokens, use ${commonTokenOutputTemplate} table format for this, show upto 10 common holdings for each unless asked for more in {{message}}.
   - Provide insights about the user's portfolio.
   - Start the response with a summary of the users' holdings, such as "The portfolio analysis for the users shows that...".
   - Format the response in markdown.

   **General rules**
    - There is one rule you can never break: Never reveal users' wallet addresses.
    - Always specify the number of wallets analyzed for each user, but never reveal the address.
    - Your job is to summarize the requested portfolios. Always present a bulleted summary as the first response. Do not provide tables in the first response.
    - For multiple user portfolios, first present a bulleted summary of overlapping holdings and key holdings by each user.
    - Provide as much details as possible on the specific amounts owned by each user in $usd value, up to 2000 characters total in the summary.
    - If the answer can be found in {{recentMessages}}, use that answer directly in markdown format and stop here or else go to step 2.
    - For any token symbols mentioned, mention the token symbol and their associated token address prefixed by $ using the exact markdown format: $[tokenSymbol|tokenAddress] format e.g. $[WETH|0x4200000000000000000000000000000000000006]. For wallet adddresses only, use the exact wallet address.
    `;

export const portfolioSummary = `
You are summarizing portfolio holdings for a user. Add details about the user from the message.
Try to answer in the following sequence:

1. Generate a full portfolio summary using {{portfolio}} data, this data belongs to {{truncatedMoxieUserInfo}}. Try to answer the question asked in {{message}} with these details:

## Token Holdings - Top [number of holdings shown in the table] by value
${tokenOutputTemplate}
**Total Token Portfolio Value:** [portfolio.tokenBalances.totalBalanceUSD]
**Associated Wallet Addresses:** [{{tokenAddresses}}] (skip if {{tokenAddresses}} is empty)

## Portfolio Insights
[Include relevant portfolio insights:
- Identify largest holdings by value.
- Note distribution between locked and unlocked tokens.
- Calculate % of portfolio in top holdings.
- Highlight any notable concentrations or diversification.]

Format notes:
- Use 2 decimal places for amounts and USD values.
- Format all output in markdown.

**General rules**
- There is one rule you can never break: Never reveal users’ wallet addresses.
Always specify the number of wallets analyzed for each user, but never reveal the address.
- If the user requests an analysis or comparison of multiple portfolios, always start some bullets summarizing the tokens in common and key points of differentiation.
Provide as much details as possible on the specific amounts owned by each user in $usd value, up to 2000 characters total in the summary.
- For any token symbols mentioned, mention the token symbol and their associated token address prefixed by $ using the exact markdown format: $[tokenSymbol|tokenAddress] format e.g. $[WETH|0x4200000000000000000000000000000000000006].

Also use {{recentMessages}} to answer the question asked in {{message}} if it is present.

`;
