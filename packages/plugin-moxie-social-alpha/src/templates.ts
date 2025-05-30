const commonPrompt = `
If displayFreeQueriesHeader = true, then include the following prompt as a header after providing the response headline:
"Social Alpha is a premium skill that enables you to access comprehensive analysis of onchain portfolios, trades, and social sentiments. You'll need to hold some of the user's creator coins to access it. New to Senpi? You get 10 free questions to try it out!  Happy exploring! 🚀

Free response {{usedFreeQueries}}/{{totalFreeQueries}}:
"
displayFreeQueriesHeader: {{displayFreeQueriesHeader}}

Example:

# Summary of Social Media Activity <- headline
This summary is derived from the top creators whose coins you own.

--- <- header
Social Alpha is a premium skill that enables you to access comprehensive analysis of onchain portfolios, trades, and social sentiments. You'll need to hold some of the user's creator coins to access it. New to Senpi? You get 10 free questions to try it out!  Happy exploring! 🚀

Free response 1/10:
---

Here is the information requested .......... <- response
`;

const headerPrompt = `
Current Date: {{currentDate}}

Previous conversations:
-----------------------------------------------[START OF PREVIOUS CONVERSATIONS]-----------------------------------------------
{{recentMessages}}
-----------------------------------------------[END OF PREVIOUS CONVERSATIONS]-------------------------------------------------

`;

const footerPrompt = `

Try to answer the user's question based on the context provided:
User Message: {{message}}

Generate the response in markdown format.
`;

// Tweet Summary prompt template ------------------------------------------------------------

export const getTweetSummaryPrompt = (displayFreeQueriesHeader: boolean) => {
    return (
        headerPrompt +
        (displayFreeQueriesHeader ? commonPrompt : "") +
        `
- Current Time: {{currentDate}}

If the question is about summarizing recent Twitter (X) activity, follow these instructions:

## Tweets JSON data:
{{tweets}}

## Ineligible Senpi Users:
{{ineligibleMoxieUsers}}

#### General Guidelines:
- The summary is derived from the **top 25 creators whose coins the user owns** for general inquiries.
  - If **specific users** are mentioned, clarify that the summary pertains **only to those users**.
- **Include as many creators as possible**, ensuring a diverse range of insights. The output can be long so try to include as many creators as possible.
- **Be as detailed and specific in the summary as possible. The more details the better vs. broad generalities. Also include links to posts that have high engagement.**
- **Avoid using platitudes. Don't over exaggerate or make claims about the overall social media landscape. Just report the facts.**

#### Detailed Steps for Summary Generation:
1. **Prioritization & Weighting:**
- **Ensure Twitter handles (@usernames)[https://x.com/username] are always hyperlinked** to their profiles.
- If a tweet is a **retweet**, summarize the content of the original post.
- If the user **replies** to another tweet, clarify the context of the conversation.
- Highlight posts that are talking about industry news, or lively debates (tweets with many replies).

2. **Structuring the Output:**
- **Hyperlink each creator's username to their profile pages.**
- **Use formatting (bullet points, bold text) to enhance readability.**
- Always summarize the overall insights at the top not the bottom of the response. Group the response by topics more than just by users.
- At the bottom of the response always suggest that users can request a "deep dive" on any user or post to get more details.
- **Ensure data accuracy** by carefully matching each tweet to its original creator and verifying the content matches before including in summary.

3. **Handling Special Cases:**
- If no relevant posts are found, **provide a user-friendly response** instead of an error message.
- Focus on the tweets from the last 24 hours, unless a **timeframe** is specified.
- If the user requests summary details for users in the ineligibleMoxieUsers list, do not include those users in the response.
` +
        footerPrompt
    );
};

// Farcaster Summary prompt template ------------------------------------------------------------

export const getFarcasterSummaryPrompt = (
    displayFreeQueriesHeader: boolean
) => {
    return (
        headerPrompt +
        (displayFreeQueriesHeader ? commonPrompt : "") +
        `
- Current Time: {{currentDate}}

If the question is about summarizing recent posts (also known as casts) on **Farcaster Web3 social media**, follow these instructions:

## Cast/Post JSON data:
{{tweets}}

## Ineligible Senpi Users:
{{ineligibleMoxieUsers}}

#### General Guidelines:
- **Summarize and extract key insights** from the most recent and engaging casts/posts.
- The summary is derived from the **top 25 creators whose coins the user owns** for general inquiries.
  - If **specific users** are mentioned, clarify that the summary pertains **only to those users**.
- **Include as many creators as possible**, ensuring a diverse range of insights. The output can be long so try to include as many creators as possible.
- **Be as detailed and specific in the summary as possible. The more details the better vs. broad generalities. Also include links to posts that have high engagement.**
- **Avoid using platitudes. Don't over exaggerate or make claims about the overall social media landscape. Just report the facts.**

#### Detailed Steps for Summary Generation:
1. **Structuring the Output:**
    - **Ensure Farcaster usernames (@handles)[https://warpcast.com/username] are always hyperlinked.**
    - **Use formatting (bullet points, bold text) to enhance readability.**
    - Always summarize the overall insights at the top not the bottom of the response. Always try group the response by topics more than just by users.
    - At the bottom of the response always suggest that users can request a "deep dive" on any user or post to get more details.

2. **Structuring the Output:**
   - **Start with an introductory summary**, highlighting common trends or notable themes.
   - **Summarize each creator's contributions separately** with clear bullet points for readability.
   - **Include actionable insights** where applicable (e.g., upcoming events, investment trends, important community votes).
   - **Hyperlink each creator's username** to their **Farcaster profile page**.
   - **Use formatting and section headers** to improve clarity.
   - **Ensure data accuracy** by carefully matching each post/cast to its original creator and verifying the content matches before including in summary.

2. **Handling Special Cases:**
    - If no relevant posts are found, **provide a user-friendly response** instead of an error message.
    - Focus on the tweets from the last 24 hours, unless a **timeframe** is specified.
    - If the user requests summary details for users in the ineligibleMoxieUsers list, do not include those users in the response
` +
        footerPrompt
    );
};

// Social Summary prompt template ------------------------------------------------------------

export const getSocialSummaryPrompt = (displayFreeQueriesHeader: boolean) => {
    return (
        headerPrompt +
        (displayFreeQueriesHeader ? commonPrompt : "") +
        `
- Current Time: {{currentDate}}

If the question is about summarizing recent social media activity by users the user follows, follow these instructions:

## Twitter (X) Posts:
{{twitterPosts}}

## Farcaster Posts/Casts:
{{farcasterPosts}}

## Ineligible Senpi Users:
{{ineligibleMoxieUsers}}

---

**General Guidelines:**
- You should default to only showing posts in the past 24 hours unless the user asks for a different time period.
- Your job is to summarize key topics and themes from the users across both X and Farcaster in a single summary. Call out industry news and hot topics.
- Do not summarize within Farcaster and X separately. Combine the summary across both platforms and report on it by topics and themes.
- **Always try to include a blend of content and perspectives across both Farcaster and X. The ideal response always contains roughly half the examples coming from each platform.
- if the user does not specify specific users, summarize social posts from the top 25 creators whose coins the user owns.
  - If **specific users** are mentioned, clarify that the summary pertains **only to those users**.
- **Include as many users as possible in the response**, ensuring a diverse range of insights. The more users and details the better.
- **Be as detailed and specific in the summary as possible. The more details the better vs. broad generalities. Also include links to posts that have high engagement.**
- **Avoid using platitudes. Don't over exaggerate or make claims about the overall social media landscape. Just report the facts.**

### **Structuring the Output:**
- Always group the response by topics and themes, not by users.
- **Hyperlink each creator's username to their Moxie profile pages.**
- **Use formatting (bullet points, bold text) to enhance readability.**
- always link to the original post on Warpcast or X
- Always summarize the overall insights at the top not the bottom of the response.
- **Ensure data accuracy** by carefully matching each tweet to its original creator and verifying the content matches before including in summary.
- Always suggest at the bottom of the response that users can request a "deep dive" on any user or post to get more details.

### **Handling Special Cases:**
- If no relevant posts are found, **provide a user-friendly response** instead of an error message.
- If the user requests summary details for users in the ineligibleMoxieUsers list, do not include those users in the response.

## **Platform-Specific Considerations:**

### **Twitter (X) Posts:**
- **Ensure Twitter handles (@usernames)[https://x.com/username] are always hyperlinked** to their profiles.
- If a tweet is a **retweet**, summarize the content of the original post.
- If the user **replies** to another tweet, clarify the context of the conversation.

### **Farcaster Posts:**
- **Ensure Farcaster usernames (@handles)[https://warpcast.com/username] are always hyperlinked.**
- Highlight posts that have many replies, indicating active debates and discussions.

` +
        footerPrompt
    );
};

// Swap Summary prompt template ------------------------------------------------------------

export const getCreatorCoinSummaryPrompt = (
    displayFreeQueriesHeader: boolean
) => {
    return (
        headerPrompt +
        (displayFreeQueriesHeader ? commonPrompt : "") +
        `
- Current Time: {{currentDate}}

If the question is about summarizing recent creator coin/token purchase activity by users the user follows, follow these instructions:

## Creator coin swaps data:
{{swaps}}

## Ineligible Senpi Users:
{{ineligibleMoxieUsers}}

**Overview**
- The trending swaps data reflects onchain activity from hundred of thousands of Base users' wallets indexed by Senpi.
- If specific users are mentioned, adjust the context to highlight only those users' trading activity.
- Rank the trending tokens in the response by: (1) Net volume (buy volume minus sell volume), (2) Highest total volume, (3) Highest percentage gains. Do not prioritize tokens with heavy negative trends.

**Data Presentation**
-Always try to reply with at least 8 tokens, preferably 10 (if there are that many)
- For each token in the summary, always include:
    - Token name
    - Token symbol (case-sensitive, formatted with their associated token address prefixed with $ in the following format: $[tokenSymbol|tokenAddress], e.g. $[WETH|0x4200000000000000000000000000000000000006])
    - Full token_address in the format: [<token_address>](https://basescan.org/token/<token_address>) format e.g. [0x...](https://basescan.org/token/0x...)
	- Unique buyers & sellers count if available.
	- Total buy and sell volume (formatted as $[value] in USD).
	- Notable Senpi users who swapped the token. Mention them by name and link to them using the markdown format:  [username](https://moxie.xyz/profile/user_id) format

**Action-Specific Conditions**
- If the user requests trending swaps for specific users, provide only those users' results. Do not rank users vs, each other.
- If the user asks explicitly for buys or sells, exclude the other. Otherwise, include both.
- If a mentioned user is in the ineligibleMoxieUsers list, exclude them from the response.
- If an invalid mention format error occurs, prompt the user to select a user by pressing @ instead of fabricating a response.

**Limitations**
- Only the last 24 hours of swaps are considered. Other timeframes cannot be requested.
- Swaps = Trades (terms are interchangeable).
- The only available dataset is swaps. Queries like "find trending swaps from my portfolio" or "based on market cap/liquidity" are not supported. For these queries, you can should mention that the sell and buy volume is for tracked wallets only.
- No pagination is available (e.g., "show me the next set of trending swaps" is unsupported).
- If a request falls outside these limitations, explain the specific reason why the agent cannot provide the summary.

**Final Notes**
- If the user asks for Trending Tokens overall, at the top of each response, always start with: This is analysis is based on hundred of thousands of Base users' wallets indexed by Senpi.
- If the user asks for Trending Tokens or token swaps from specific users, always start with: Here are the trending tokens or swaps from these users (cite them by name).
- At the end of each response, ask the user if you can help the buy any of the tokens

` +
        footerPrompt
    );
};

export const getNonCreatorCoinSummaryPrompt = (
    displayFreeQueriesHeader: boolean
) => {
    return (
        headerPrompt +
        (displayFreeQueriesHeader ? commonPrompt : "") +
        `
- Current Time: {{currentDate}}

If the question is about summarizing recent token purchases (ERC20) activity by users the user follows, follow these instructions:

## Trading/Swaps data:
{{swaps}}

## Token details data:
{{tokenDetails}}

## Ineligible Senpi Users:
{{ineligibleMoxieUsers}}

**Overview**
- If specific users are mentioned, adjust the context to highlight only those users' trading activity.
- Output all 10 tokens.

**Data Presentation**
- For each token in the summary, always include:
    - **Token name first & symbol (case-sensitive, formatted with their associated token address in the following format: $[tokenSymbol|tokenAddress], e.g. $[WETH|0x4200000000000000000000000000000000000006])**
    - **Full token_address in the format: token_address**
    - **Unique holders count**
    - **Fully diluted market cap**
    - **Current price**
    - **% Price Change (last hour)**
    - **Top 3 LP Liquidity (sum)**
    - **Net buy volume$**
    - **Buy volume$**
    - **Sell volume$**
    - Notable Senpi users who swapped the token. Mention them by name and link to them using the markdown format:  [username](https://moxie.xyz/profile/user_id) format

**Action-Specific Conditions**
- If the user requests trending swaps for specific users, provide only those users' results. Do not rank users vs, each other.
- If an invalid mention format error occurs, prompt the user to select a user by pressing @ instead of fabricating a response.
- If a token symbol is mentioned, mention the tokens symbol and their associated token address using the exact markdown format: $[tokenSymbol|tokenAddress] format e.g. $[WETH|0x4200000000000000000000000000000000000006].

**Limitations**
- The only available dataset is swaps. Queries like "find trending swaps from my portfolio" or "based on market cap/liquidity" are not supported. For these queries, you can should mention that the sell and buy volume is for tracked wallets only.
- No pagination is available (e.g., "show me the next set of trending swaps" is unsupported).
- If a request falls outside these limitations, explain the specific reason why the agent cannot provide the summary.

**Final Notes**
- If the user asks for Trending Tokens overall, at the top of each response, always start with: This is analysis is based on hundred of thousands of Base users' wallets indexed by Senpi. Tokens are ranked based on Net Buy Volume based on the timeframe in the question (if there is no timeframe, default is 24 hours)
- If the user asks for Trending Tokens or token swaps from specific users, always start with: Here are the trending tokens or swaps from these users (cite them by name).
- If a token is mentioned, mention the tokens by symbol and their associated token address using the exact markdown format: $[tokenSymbol|tokenAddress] format e.g. $[WETH|0x4200000000000000000000000000000000000006].
- At the end of each response, ask the user if you can help the buy any of the tokens, or check any other timeframe.` +
        footerPrompt
    );
};

// Current User Context prompt template ------------------------------------------------------------

export const currentUserContext = `
There are two tasks to complete:
1. Extract the Moxie IDs from the message for whom the user wants to get the summary
2. Check if the user is asking for summary of top creators or specific users

The output should be a JSON object with the following structure:
{
    "requestedUsers": ["M4", "M19"],
    "isCreatorQuery": true/false
}

## Examples:
{{examples}}

## For these inputs, provide the JSON output:

userMoxieId: {{userMoxieId}}

previousQuestions:
{{previousQuestion}}

latestMessage: {{latestMessage}}

Focus on recent messages.
`;

export const topCreatorsTwitterExamples = `
Example 1: What is the twitter activity of my creators?
userMoxieId: M2
Output:
{
    "requestedUsers": [],
    "isCreatorQuery": true
}


Example 2: What is the hot on twitter?
userMoxieId: M2
Output:
{
    "requestedUsers": [],
    "isCreatorQuery": true
}

Example 3: What is new on twitter for @[betashop.eth|M4] & @[jessepollak|M1245] ?
userMoxieId: M2
Output:
{
    "requestedUsers": ["M4", "M1245"],
    "isCreatorQuery": false
}

Example 4: What are my friends upto on twitter?
userMoxieId: M2
Output:
{
    "requestedUsers": [],
    "isCreatorQuery": true
}

Example 5: Give my twitter summary ?
userMoxieId: M2
Output:
{
    "requestedUsers": ["M2"],
    "isCreatorQuery": false
}
`;

export const topCreatorsFarcasterExamples = `
Example 1: What is the farcaster activity of my creators?
userMoxieId: M2
Output:
{
    "requestedUsers": [],
    "isCreatorQuery": true
}

Example 2: What is the hot on farcaster?
userMoxieId: M2
Output:
{
    "requestedUsers": [],
    "isCreatorQuery": true
}

Example 3: What is new on farcaster for @[betashop.eth|M4] & @[jessepollak|M1245]?
userMoxieId: M2
Output:
{
    "requestedUsers": ["M4", "M1245"],
    "isCreatorQuery": false
}

Example 4: What are my friends upto on farcaster?
userMoxieId: M2
Output:
{
    "requestedUsers": [],
    "isCreatorQuery": true
}

Example 5: Give my farcaster summary ?
userMoxieId: M2
Output:
{
    "requestedUsers": ["M2"],
    "isCreatorQuery": false
}

Example 6:
previousQuestions:
Give me portfolio summary for @[betashop.eth|M4] & @[jessepollak|M1245]?
Give me the farcaster summary for those two users

userMoxieId: M2
Output:
{
    "requestedUsers": ["M4", "M1245"],
    "isCreatorQuery": false
}
`;

export const topCreatorsSwapExamples = `
Example 1: What are my friends buying?
userMoxieId: M2
Output:
{
    "requestedUsers": [],
    "isCreatorQuery": true
}

Example 2: What are my creators buying?
userMoxieId: M2
Output:
{
    "requestedUsers": [],
    "isCreatorQuery": true
}

Example 3: What are some interesting tokens to buy?
userMoxieId: M2
Output:
{
    "requestedUsers": [],
    "isCreatorQuery": true
}

Example 4: show my recent swaps?
userMoxieId: M2
Output:
{
    "requestedUsers": ["M2"],
    "isCreatorQuery": false
}

Example 5: show my recent swaps for @[betashop.eth|M4] & @[jessepollak|M1245]?
userMoxieId: M2
Output:
{
    "requestedUsers": ["M4", "M1245"],
    "isCreatorQuery": false
}
`;

export const socialSummaryExamples = `
Example 1: What is the social activity of my creators?
userMoxieId: M2
Output:
{
    "requestedUsers": [],
    "isCreatorQuery": true
}

Example 2: What is the hot on social media?
userMoxieId: M2
Output:
{
    "requestedUsers": [],
    "isCreatorQuery": true
}

Example 3: What is new on social media?
userMoxieId: M2
Output:
{
    "requestedUsers": [],
    "isCreatorQuery": true
}

Example 4: What are my friends upto?
userMoxieId: M2
Output:
{
    "requestedUsers": [],
    "isCreatorQuery": true
}

Example 5: Give my social media summary?
userMoxieId: M2
Output:
{
    "requestedUsers": ["M2"],
    "isCreatorQuery": false
}

Example 6:
previousQuestions:
Give me portfolio summary for @[betashop.eth|M4] & @[jessepollak|M1245]?
Give me the social media summary for those two users

userMoxieId: M2
Output:
{
    "requestedUsers": ["M4", "M1245"],
    "isCreatorQuery": false
}

Example 7:
previousQuestions:
what is @[betashop.eth|M4] doing on farcaster ?
what is he trading?

userMoxieId: M2
Output:
{
    "requestedUsers": ["M4"],
    "isCreatorQuery": false
}
`;

// Swap Summary Input Context Extraction prompt template ------------------------------------------------------------

export const socialSummaryInputContextExtraction = `Please analyze the message below to extract essential details about the social summary request: {{message}}

    Current Time: {{currentDate}}

    Your task is to return a JSON object with the following structure:
    \`\`\`json
    {
    "isTopTokenOwnersQuery": true/false,
    "selfQuery": true/false,
    }
    \`\`\`

    If the user is asking for a specific user, then isTopTokenOwnersQuery should be false.

    Consider these examples for guidance:
    - "What's the news today?" should result in: isTopTokenOwnersQuery: true, selfQuery: false
    - "What is the social activity of my creators?" should result in: isTopTokenOwnersQuery: true, selfQuery: false
    - "What is the hot on social media?" should result in: isTopTokenOwnersQuery: true, selfQuery: false
    - "What are my friends upto?" should result in: isTopTokenOwnersQuery: true, selfQuery: false
    - "What's new on social media?" should result in: isTopTokenOwnersQuery: true, selfQuery: false
    - "What is @[betashop.eth|M4], @[jessepollak|M1245] doing on farcaster?" should result in: isTopTokenOwnersQuery: false, selfQuery: false
    - "What is @[betashop.eth|M4], @[jessepollak|M1245] doing on twitter?" should result in: isTopTokenOwnersQuery: false, selfQuery: false
    - "What is @[betashop.eth|M4], @[jessepollak|M1245] doing?" should result in: isTopTokenOwnersQuery: false, selfQuery: false
    - "What is betashop.eth is doing on social media?" should result in: isTopTokenOwnersQuery: false, selfQuery: false
    - "What is betashop.eth doing on farcaster?" should result in: isTopTokenOwnersQuery: false, selfQuery: false
    - "What is betashop.eth doing on twitter?" should result in: isTopTokenOwnersQuery: false, selfQuery: false
    - "Show my social summary?" should result in: isTopTokenOwnersQuery: false, selfQuery: true
    - "What is my social media activity?" should result in: isTopTokenOwnersQuery: false, selfQuery: true
`;

export const swapSummaryInputContextExtraction = `Please analyze the message below to extract essential details about the swap request: {{message}}

    Current Time: {{currentDate}}

    Your task is to return a JSON object with the following structure:
    \`\`\`json
    {
    "isGeneralQuery": true/false,
    "selfQuery": true/false,
    "onlyIncludeSpecifiedMoxieIds": true/false,
    "isTopTokenOwnersQuery": true/false,
    "timeFilter": {
        "startTimestamp": "YYYY-MM-DD HH:MM:SS",
        "endTimestamp": "YYYY-MM-DD HH:MM:SS"
    }
    }
    \`\`\`

    Consider these examples for guidance:
    - "Show me trending tokens" should result in: isGeneralQuery: true, selfQuery: false, onlyIncludeSpecifiedMoxieIds: false, isTopTokenOwnersQuery: false
    - "Show swaps for M3 and M5" should result in: isGeneralQuery: false, selfQuery: false, onlyIncludeSpecifiedMoxieIds: true, isTopTokenOwnersQuery: false
    - "Show my trades/swaps?" should result in: isGeneralQuery: false, selfQuery: true, onlyIncludeSpecifiedMoxieIds: true, isTopTokenOwnersQuery: false
    - "Show all swaps from last week" should result in: isGeneralQuery: true, with appropriate timeFilter, selfQuery: false, isTopTokenOwnersQuery: false
    - "Show M3's swaps from yesterday" should result in: isGeneralQuery: false, selfQuery: false, onlyIncludeSpecifiedMoxieIds: true, with appropriate timeFilter, isTopTokenOwnersQuery: false
    - "What is M4 doing?" should result in: isGeneralQuery: false, selfQuery: false, onlyIncludeSpecifiedMoxieIds: true, isTopTokenOwnersQuery: false
    - "What are my top fan tokens doing in the market" should result in: isGeneralQuery: false, selfQuery: false, onlyIncludeSpecifiedMoxieIds: false, isTopTokenOwnersQuery: true
    - "What are my favorite creators doing?" should result in: isGeneralQuery: false, selfQuery: false, onlyIncludeSpecifiedMoxieIds: false, isTopTokenOwnersQuery: true
    - "What are the trending tokens among my top creators?" should result in: isGeneralQuery: false, selfQuery: false, onlyIncludeSpecifiedMoxieIds: false, isTopTokenOwnersQuery: true
    - "Show me what my biggest token holders are trading" should result in: isGeneralQuery: true, selfQuery: false, onlyIncludeSpecifiedMoxieIds: false, isTopTokenOwnersQuery: true
    - "can you display my recent trades ?" should result in: isGeneralQuery: false, selfQuery: true, onlyIncludeSpecifiedMoxieIds: true, isTopTokenOwnersQuery: false`;
