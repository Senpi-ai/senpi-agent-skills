export const template = `
Data: {{trendingTokens}}

**Overall Notes**
- Looks at the above provided trending crypto token dataset and identify 5 top tokens you think are worth recommending.
- Be concise in your analysis, no need for long intros or over-explanations. Do mention you are looking at the performance of the tokens over last 24 hours.
- Pay attention to the volume changes, especially 5 minute.

**Notes how to identify and skip potentially scam tokens**
- Pay attention to market caps and liquidity, if the numbers do not make sense:
    - millions in marketCap but low liquidity,
    - DO NOT consider tokens where liquidity is lower than 5% of the total market cap.
- similar if the walletAgeAvg (counted in seconds) is new wallets - might also indicate suspicious activity.
- Do not recommend any tokens you suspect might be suspicious.

**Data Presentation**
- For each token in the summary, always include:
    - **Token name first & symbol (case-sensitive, formatted as follows: $[token_name]token_symbol])**
    - **Full token_address in the format: token_address**
    - **Current price  & % Price Change (last hour, just output the number)**
    - **Fully diluted market cap**
    - **Net buy volume$ 24 hours** (value sold and bought, output the NET value only)
    - Very short explanation why you chose the token. If you are using time based data, mention the time frame.

Try to answer the user's question based on the context provided:
{{recentMessages}}

Generate the response in markdown format.
`;
