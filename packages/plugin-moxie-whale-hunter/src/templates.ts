export const topBaseTradersSummary = `

- Current Time: {{currentDate}}

If the question is about top base traders/whales, follow these instructions:

## Top Base Traders In The Last 24 Hours:
{{topTraders}}

#### General Guidelines:
- The summary is derived from the trading volume of senpi users on base in last 24 hours.
- Add the header of the summary saying "Senpi indexes hundred of thousands of Base users. Here's a detailed overview of the top traders from the last 24 hours:"
- **Include as many traders as possible**, ensuring a diverse range of insights. The output can be long so try to include as many traders as possible.
- **Be as detailed and specific in the summary as possible. The more details the better vs. broad generalities. Also include links to posts that have high engagement.**
- **Avoid using platitudes. Don’t over exaggerate or make claims about the overall social media landscape. Just report the facts.**
- Present the trade volume summary in the format: "user traded a total volume of $123 (+$100 buy, -$23 sell)". Ensure that the total trade volume, buy_volume, and sell_volume are prefixed with a '$' symbol to indicate their monetary value.
- Always display the total trade volume in the summary, even if it matches the buy_volume or sell_volume. Avoid displaying only the buy_volume or sell_volume.
- Mention the traders by name and link to them using the exact markdown format: @[username|user_id] format e.g. @[zoravar|M234]. If username is not available, use the exact format: @[user_id|user_id] e.g. @[M234|M234]. Do not add any extra characters such as slashes.
- Mention the tokens by symbol and their associated token address using the exact markdown format: $[tokenSymbol|tokenAddress] format e.g. $[WETH|0x4200000000000000000000000000000000000006].

**Limitations**
- Swaps = Trades (terms are interchangeable).
- No pagination is available (e.g., "show me the next set of traders" is unsupported).
- If a request falls outside these limitations, explain the specific reason why the agent cannot provide the summary.
`;

export const topTradersOfAToken = `

- Current Time: {{currentDate}}

If the question is about top traders of a token, follow these instructions:

## Top Traders of a Token:
{{topTradersOfAToken}}


#### General Guidelines:
- The summary is derived from the trading volume of senpi users of a token on base in last 24 hours.
- Add the header of the summary saying "Senpi indexes hundred of thousands of Base users. Here's a detailed overview of the top traders of the token from the last 24 hours:"
- **Include as many traders as possible**, ensuring a diverse range of insights. The output can be long so try to include as many traders as possible.
- **Be as detailed and specific in the summary as possible. The more details the better vs. broad generalities. Also include links to posts that have high engagement.**
- **Avoid using platitudes. Don’t over exaggerate or make claims about the overall social media landscape. Just report the facts.**
- Present the trade volume summary in the format: "user traded a total volume of $123 (+$100 buy, -$23 sell)". Ensure that the total trade volume, buy_volume, and sell_volume are prefixed with a '$' symbol to indicate their monetary value.
- Always display the total trade volume in the summary, even if it matches the buy_volume or sell_volume. Avoid displaying only the buy_volume or sell_volume.
- Mention the traders by name and link to them using the exact markdown format: @[username|user_id] format e.g. @[zoravar|M234]. If username is not available , use the exact format: @[user_id|user_id] e.g. @[M234|M234]. Do not add any extra characters such as slashes.
- Mention the tokens by symbol and their associated token address using the exact markdown format: $[tokenSymbol|tokenAddress] format e.g. $[WETH|0x4200000000000000000000000000000000000006].

**Limitations**
- Only the last 24 hours of swaps are considered. Other timeframes cannot be requested.
- Swaps = Trades (terms are interchangeable).
- No pagination is available (e.g., "show me the next set of traders" is unsupported).
- If a request falls outside these limitations, explain the specific reason why the agent cannot provide the summary.

`;

export const extractTokenAddressTemplate = `

Your primary task is to identify all valid token addresses in the user's most recent message when (and only when) the user explicitly requests the top holders of those tokens. A valid token address is defined as a string beginning with "0x" and consisting of exactly 42 characters total (e.g., "0x" followed by 40 hexadecimal characters).

Also consider the possibility that the token address might have appeared in earlier messages, not just the most recent one. If the user references a token by a notation like $[SYMBOL|0x123abc...], you should extract only the address part ("0x123abc...").

**Important details and constraints**:
1. **User Intent**: Confirm that the user is asking for top token holders before extracting any addresses. If the user does not request top holders, do not extract addresses.
2. **Multiple Tokens**: The user may mention multiple tokens. If they ask for the top holders of each mentioned token, extract all relevant addresses.
3. **Notation**: If a token is specified via a ticker or symbol (e.g., $MYTOKEN) followed by an address in brackets, only extract the address if the user asks for its top holders. e.g. $[MOXIE|0x8c9037d1ef5c6d1f6816278c7aaf5491d24cd527] then extract 0x8c9037d1ef5c6d1f6816278c7aaf5491d24cd527
4. **Creator Coins**: We do not support creator coins. If the user mentions a creator coin (or indicates it is a creator coin) and requests holders, do not extract that address.
5. **Top n holders**: The user may request the top n holders of a token. If they do, you should extract the top n holders of the token. Default is 10.
5. **Output Format**: Return a JSON object with a single key, tokenAddresses, pointing to an array of all extracted addresses. For example:
   {
       "tokenAddresses": ["0x1234567890123456789012345678901234567890", "0xabcdef1234567890abcdef1234567890abcdef1234"],
       "topNHolders": 10
   }

Generate the output for the conversation below, following the above instructions precisely.

Conversation:
{{conversation}}

Latest Message:
{{latestMessage}}
`;

export const topTokenHoldersSummary = `

You are tasked with generating a comprehensive summary of top token holders for the specified token. Use only the provided data to create a factual analysis, without making any assumptions or adding speculative information.

Instructions for generating the summary:

1. Include only information that is explicitly provided in the data:
   - Token name and symbol (if available in tokenDetails)
   - Current price in USD (if available in tokenDetails)
   - Only include other metrics (Market Cap, Volume, Liquidity) if they are present in the data

2. Create a formatted table of top holders only if holder data exists:
   | Senpi User | Holdings | Holdings (USD) |
   Where:
   - Senpi User is the holder's profile link from the data
   - Holdings shows the raw token amount from the data
   - Holdings (USD) shows the value in USD (only if price data is available)

3. Provide detailed observations about holder distribution and concentration:
   - Calculate and highlight the percentage of total supply held by top holders
   - Compare individual holder percentages against total supply
   - Calculate and mention the cumulative percentage held by all listed holders

Important Notes:
- If any data point is missing, clearly state that it's not available rather than making assumptions
- If holder data is not found (in holdersNotFound), explicitly state this
- Format numbers based on actual values in the data
- Maintain strictly factual reporting without speculation
- Mention the tokens by symbol and their associated token address using the exact markdown format: $[tokenSymbol|tokenAddress] format e.g. $[WETH|0x4200000000000000000000000000000000000006].

Example Output Format (only using available data):

----
# Token Analysis:

## **Token Name**: tokenName ($[tokenSymbol|tokenAddress], e.g. $[WETH|0x4200000000000000000000000000000000000006])
- **Token Address**: tokenAddress
- **Current Price**: priceUSD
- **Volume Change (24h)**: volumeChange24Hours%
- **Market Cap (Fully Diluted)**: fullyDilutedMarketCapUSD
- **Unique Holders**: holders
- **Unique Buy/Sell (24h)**:
  - Buys: uniqueBuysLast24Hours
  - Sells: uniqueSellsLast24Hours
- **Total Supply**: tokenTotalSupply

---
[Other metrics only if explicitly provided]

# Top Holders:
Here are the top holders of tokenName ($[tokenSymbol|tokenAddress]) amongst hundred of thousands of Base users Senpi indexes.

[Only show table if holder data exists]
| Senpi User | Holdings | Holdings (USD) |
|------------|----------|----------------|
| profile_link | total_balance | total_balance_in_usd|

[Actual data from topTokenHolders]
Do not make any changes to the profile_link. It should start with '@' and be in the format of @[username|user_id].

[Only include observations based on actual data]

[If applicable] Note: Unable to fetch holder data for this token.

Token Details:
{{tokenDetails}}

Top Token Holders:
{{topTokenHolders}}

Token Total Supply:
{{tokenTotalSupply}}

If token details or top holder details are not provided, output:
"I apologize, but I don't have enough data to provide a meaningful summary. Please ensure the token details and holder information are available."

Conclude your response by asking the user if they are interested in exploring the portfolio or trades of any particular top holder.

`;
