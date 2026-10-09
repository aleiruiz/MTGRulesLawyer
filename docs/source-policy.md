# Source and image use decision

**Reviewed:** 2026-10-09  
**Scope:** MVP rules and card data imports, card previews, citations, and public ruling pages. This is an implementation decision based on the linked policies, not legal advice or permission beyond those policies.

## Wizards of the Coast material

The [Wizards Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy) says fan content must be free to access without payments, surveys, downloads, subscriptions, or email registration. It requires a clear unofficial status and this notice:

> [Title of your Fan Content] is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.

The policy also distinguishes fan-created work from verbatim copying and reposting of Wizards material. It gives no excerpt threshold and separately says Wizards trademarks cannot be used without prior written permission. The following scope decisions apply:

- **Importing rules and Oracle text:** the policy does not expressly answer whether importing these works into a private server database for retrieval is permitted. Keep any development import private and do not make the corpus or a bulk export available to users. Obtain written guidance from Wizards before using these imports to serve public content.
- **Showing excerpts:** a short excerpt attached to original analysis may be different from verbatim republication, but the policy does not define a safe excerpt length. Do not show rules or Oracle text excerpts on public ruling pages until that use is confirmed in writing. Public answers can link to the official rules page and card source page in the meantime.
- Never publish a bulk rules file, bulk card dump, or replacement card/rules database. Keep answer summaries and reasoning as original app content.
- Make public rulings readable in a browser without a required app download, account, or email registration. The free native app can offer the full interactive experience.
- Put the exact notice above in the app's About screen and on public ruling pages once a public title is selected. Keep the notice visible near fan content.
- The current working name, “MTG Rules Lawyer,” uses the MTG mark. Do not use it as a public product name unless Wizards grants prior written permission. Before release, either obtain that permission or choose a title that does not use Wizards marks. Do not use Wizards logos or present the app as official. Keep existing notices on any card image intact.

The policy page states it was last updated 2017-11-15. Recheck the policy before release and whenever the material or product distribution changes. Any use not clearly covered by the policy requires written guidance from Wizards before implementation.

## Scryfall data and images

Sources reviewed:

- [Scryfall API documentation and use guidelines](https://scryfall.com/docs/api)
- [Scryfall bulk data documentation](https://scryfall.com/docs/api/bulk-data)
- [Scryfall API traffic guidance](https://scryfall.com/docs/faqs/i-m-having-trouble-accessing-the-scryfall-api-or-i-m-blocked-17)

The API reference describes Scryfall data and images as available for creating additional Magic software, research, and community content. Its use guidelines prohibit paywalling Scryfall data, implying Scryfall endorsement, creating a new game from the data, or simply repackaging/proxying it. The traffic guidance says to keep API traffic under 10 requests per second and to use bulk data instead of repeated live lookups or bulk image downloads.

The API/bulk documentation could not be fetched directly during this review (HTTP 403). The API use-guideline summary below was visible in an indexed copy of Scryfall's API documentation, so treat it as provisional until the live page is available. Traffic limits below come from Scryfall's directly reviewed traffic FAQ.

For this app:

- Import the Oracle Cards bulk file for the server-side lookup and ruling workflow. Retain only fields needed for Oracle identity, names, faces, Oracle text, type lines, image references, and source provenance. Do not expose the raw bulk file or a bulk export endpoint; the app adds rules retrieval and scenario analysis to the data.
- Use Scryfall's HTTPS image URIs in the card confirmation and evidence UI only after confirming the live image guidance. Until then, use text-only previews. The conservative implementation proposal is to avoid downloading, transforming, cropping, recoloring, watermarking, proxying, or redistributing images; link each future preview to its Scryfall card page.
- The indexed API guideline says not to cover or clip artist/copyright notices, distort images, or add watermarks. It says art crops need adjacent artist/copyright credit or a full card image in the same interface. Treat these as provisional display limits until the live official page can be checked; use complete, unaltered images if approval is obtained.
- Credit Scryfall near card data/images with a link to Scryfall. Preserve artist and copyright credits from the source record where the interface uses an art crop.
- Use the bulk file for imports rather than per-card API requests. If live API calls are added, send a meaningful `User-Agent` and `Accept` header, use HTTPS, stay below the published rate guidance, and back off on rate-limit errors.

The Scryfall API documentation page returned HTTP 403 to the documentation fetcher during this review. The implementation rules above are a conservative summary of the linked official documentation and its indexed use-guideline text. Re-open and verify the live Scryfall terms before a public launch; if the current terms cannot be confirmed or any intended use falls outside them, pause image/data use and request guidance from Scryfall. The same launch check must verify that the current Wizards policy still permits the planned fan content.

## Required interface credits

Wizards notice, with the title substituted:

> MTG Rules Lawyer is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.

Scryfall credit for card previews and data:

> Card data and images provided by [Scryfall](https://scryfall.com/). Magic: The Gathering card names, text, and images are property of Wizards of the Coast LLC and their respective owners.

The Scryfall credit is an app attribution choice. It does not replace any artist/copyright notices printed on card images or imply an endorsement by Scryfall. For public release, the approved product title must also replace the bracketed title in the Wizards notice. Until the text and trademark questions above are resolved, public ruling pages must link to sources without reproducing Wizards rules/card text or using the current working name as a public brand.
