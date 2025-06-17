export const tutorialTemplate = `
Your job is to provide the appropriate tutorial based on the user's request for help based on the historical messages.

For each tutorial, please provide the embeded video link for the tutorial in the following format:

<iframe src="YOUTUBE_EMBED_LINK" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>

Here are the available tutorials and their corresponding examples:

1. Getting Started Tutorial

- This tutorial is for users who are new to Senpi and want to learn how to use it.
- It's also helpful for users who might have trouble using certain features of Senpi.
- It's also helpful for users who want to learn how to use Senpi to its full potential.

Link: ${process.env.GET_STARTED_TUTORIAL_URL_EMBED}

2. Autonomous Trade Tutorial

- This tutorial is for users who want to learn how to set up an autonomous trade orders on Senpi. From the tutorial, user can learn how to set up custom rules for their autonomous trade orders.
- It's also helpful for users who have trouble setting up their autonomous trade orders with custom complex rules.

Link: ${process.env.AUTONOMOUS_TRADE_TUTORIAL_URL_EMBED}

3. Token Research Tutorial

- This tutorial is for users who want to learn how to research tokens using some Skills provided by Senpi.
- It's also helpful for users who have trouble researching tokens on Senpi.

Link: ${process.env.TOKEN_RESEARCH_TUTORIAL_URL_EMBED}

4. Limit Order Tutorial

- This tutorial is for users who want to learn how to set up a limit order on Senpi.
- It's also helpful for users who have trouble setting up their limit order.

Link: ${process.env.LIMIT_ORDER_TUTORIAL_URL_EMBED}

If you don't find any of the tutorials relevant to the user's request, just say "Sorry, I don't find any tutorials for that request. For more help, please contact the Senpi team at [our Dojo](${process.env.SENPI_TELEGRAM_GROUP_URL})."

Here are the recent user messages for context:
{{recentMessages}}
`;

export const videoLinkTemplate = `
Based on the text given, extract the video link for the tutorial into an array of youtube video links based on the appearance order of the links in the text.

# Example 1

\`\`\`
Here is a sample input text:
- [Link 1](${process.env.GET_STARTED_TUTORIAL_URL})
- [Link 2](${process.env.AUTONOMOUS_TRADE_TUTORIAL_URL})
\`\`\`

# Response:

\`\`\`
[
    "${process.env.GET_STARTED_TUTORIAL_URL_EMBED}",
    "${process.env.AUTONOMOUS_TRADE_TUTORIAL_URL_EMBED}"
]
\`\`\`


Here is the text:
{{text}}
`;
