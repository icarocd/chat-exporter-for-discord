# Chat Exporter for Discord

Browser extension that adds an export button to Discord web. It saves the open conversation (messages and attachments) to a `.zip` file.

Works in Chromium-based browsers (Chrome, Brave, Edge).

## Install

- Download this repository (`git clone` or "Code" > "Download ZIP" and extract it)
- Open `chrome://extensions` (in Brave, `brave://extensions`)
- Turn on "Developer mode"
- Click "Load unpacked" and select the repository folder
- Open or reload `https://discord.com`

## Use

Open a conversation (server channel, DM or group DM). An "⇩ Export" button shows in the bottom right corner, with these options:

- **Only what is on screen**: exports the messages already loaded
- **Last N scrolls...**: scrolls up N times, then exports
- **Whole conversation**: scrolls up to the start of the history, then exports
- **Download attachments**: checkbox to include or skip attachment files

During the export a counter shows the progress and the button changes to "✕ Cancel". Cancel saves what was already collected, marked as partial.

## Output

The `.zip` file goes to the browser download folder, named `discord_<conversation>_<date>.zip`. It has:

- `conversation.txt`: one entry per message with date, author, text, replied message and attachment paths
- `conversation.html`: the same conversation for reading in a browser, with images and videos inline
- `attachments/`: files sent in the conversation (images, videos, documents)

## How it works

- Reads only what Discord already shows on the page, using the session open in the browser
- Does not use your token, does not call the Discord API and does not send data to any other place
- Scrolls the conversation to load older messages, like a user would
- Downloads attachments only from `cdn.discordapp.com` and `media.discordapp.net`
- Runs only on `https://discord.com/*`

## Limits

- Depends on the Discord page structure. If Discord changes its layout, the export may break until the selectors in `content.js` are updated
- Long conversations can take a few minutes with "Whole conversation"
- Link previews (embeds), stickers and custom emojis are not exported
- All data stays in memory until the zip is saved, so very large exports may be slow or fail

## Disclaimer

This software is provided "as is", without warranty of any kind, express or implied. Use it at your own risk.

The authors are not responsible for any damage, data loss, account action, bug, misuse, or any claim of any kind that comes from using this software.

This project is not affiliated with, endorsed by, or sponsored by Discord Inc. "Discord" is a trademark of Discord Inc.

You are the only one responsible for how you use this tool and the data you export, including following the Discord Terms of Service, local laws, and the privacy of the people in the conversations.

## License

MIT. See `LICENSE`.
