# Notes for Certification

This extension does not require a separate product account, license key, or paid subscription.

Important testing note:
The main functionality only appears on supported Echo360 course video pages. The extension injects a bilingual subtitle overlay when subtitle data is available on these pages.

Supported page scope:

- echo360.net.au video pages
- canvas.lms.unimelb.edu.au pages that embed or link to Echo360 content

How to test:

1. Install the extension and pin it to the toolbar.
2. Click the extension icon to open the settings page.
3. In the settings UI, verify these options are available: enable/disable subtitles, Chinese/English subtitle toggles, target language, font sizes, colors, background opacity, and TXT export state.
4. Open a supported Echo360 video page that already has English CC subtitles available.
5. Start playback. The extension should detect subtitle cues, render an overlay, and request translation results for subtitle text.
6. When subtitles are loaded, the export area should allow exporting a bilingual TXT file with timestamps.

Dependencies:

- The extension depends on subtitle data being available from the Echo360 page.
- Translation requests are sent only to translate.googleapis.com.

No special credentials are provided by the developer.
If reviewers do not have access to a supported Echo360 course page, they can still verify the settings UI from the extension popup/options page, but the subtitle overlay and export workflow require an actual supported video page with subtitle data.

Privacy and behavior:

- No user account data is collected by this extension.
- No browsing history is uploaded.
- Only subtitle text is sent to the translation service when translation is needed.
