# Android release (Google Play)

The Android app is built in the cloud with [EAS Build](https://docs.expo.dev/build/introduction/) from [`apps/mobile/eas.json`](../apps/mobile/eas.json). The free Expo plan is enough. Store texts, Play Console answers and graphics are in [`play-store/listing.md`](play-store/listing.md).

| Profile      | Output                       | Use                                             |
| ------------ | ---------------------------- | ----------------------------------------------- |
| `preview`    | APK, installable from a link | Try the app on your own phone before uploading. |
| `production` | AAB (Android App Bundle)     | Upload to Google Play.                          |

Both profiles point the app at `https://api.mtgruleslawyer.io` and `https://mtgruleslawyer.io`. The Supabase values come from EAS environment variables (step 3). The Play version code is kept by EAS and goes up by one on every production build; change `version` in [`app.json`](../apps/mobile/app.json) when you want a new version name.

## One-time setup

Run these from `apps/mobile` on your computer.

1. Install the EAS command line and sign in with your Expo account:

   ```sh
   npm install --global eas-cli
   eas login
   ```

2. Link the app to an Expo project. This adds `owner` and `extra.eas.projectId` to `app.json`; commit that change through a PR (the project ID is not secret).

   ```sh
   eas init
   ```

3. Add the Supabase values the app needs, using the same URL and publishable key as the web app (Supabase → Project Settings → API). They are compiled into the app, as on the web, so `plaintext` visibility is fine. Never add `SUPABASE_SECRET_KEY` or `OPENAI_API_KEY` here.

   ```sh
   eas env:create --name EXPO_PUBLIC_SUPABASE_URL --value "https://<project>.supabase.co" --environment production --environment preview --visibility plaintext
   eas env:create --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY --value "<publishable key>" --environment production --environment preview --visibility plaintext
   ```

4. Supabase **Authentication → URL Configuration** must list `mtgruleslawyer://auth/callback` as a redirect URL (already part of [deploy](deploy.md#after-the-first-deploy)). Without it, Google and GitHub sign-in fail in the app.

## Build

```sh
eas build --platform android --profile preview      # APK for your phone
eas build --platform android --profile production   # AAB for Google Play
```

On the first build, EAS asks whether to generate an Android keystore. Answer **yes**: EAS creates the upload key and keeps it. Download a backup with `eas credentials` → Android → production → Keystore → Download, and store it somewhere safe outside the repo. Google holds the real app signing key (Play App Signing), so a lost upload key can be reset through Play support, but the backup avoids that.

When the build finishes, the command prints a link where you can download the APK or AAB.

## Google Play Console

1. **Create app**: name `MTG Rules Lawyer`, default language English (United States), App, Free. Accept the declarations.
2. **Testing → Internal testing**: create a release and upload the `.aab` by hand (Play requires the first upload to be manual). Add yourself as a tester and install it from the opt-in link.
3. Fill **App content** (privacy policy, ads, app access, content rating, target audience, data safety, account deletion) and **Main store listing** with the texts and graphics from [`play-store/listing.md`](play-store/listing.md). Take the phone screenshots on the internal-testing build.
4. **Closed testing**: personal developer accounts created after November 13, 2023 must run a closed test with at least 12 testers who stay opted in for 14 days in a row before Play allows a production release. Create a closed track, add the testers (a Google Group or a list of emails), send them the opt-in link, and promote the internal build to it.
5. After the 14 days, **Dashboard → Apply for production**, answer the questions about the test, and once approved promote the release to **Production**.

## Later releases

1. Merge the changes to `main`, and bump `version` in `app.json` if the release should show a new version name.
2. `eas build --platform android --profile production`.
3. Upload the AAB to a new release in Play Console, or set up `eas submit` (below).

`eas submit --platform android --profile production` uploads the latest build to the internal track as a draft. It needs a Google Cloud service account with access to the Play Console app; follow [Expo's guide](https://docs.expo.dev/submit/android/) and upload its JSON key to EAS when `eas submit` asks for it. Never commit that key.
