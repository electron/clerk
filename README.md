# clerk
Verify PRs have release notes

Translation types
Text translation
English - Detected
English
Source text
From 2dee76baf09f3f72c8a192a6483f23aec527e057 Mon Sep 17 00:00:00 2001
From: mowjoejoejoejoe <124041561+mowjoejoejoejoe@users.noreply.github.com>
Date: Sat, 11 Mar 2023 06:36:43 -0600
Subject: [PATCH] Revert "Update CODEOWNERS (#5)"

This reverts commit dcf4311198ce8e5eddd2d24cd5f2d0add289b8e8.
---
 .github/CODEOWNERS | 41 ++++++++---------------------------------
 1 file changed, 8 insertions(+), 33 deletions(-)

diff --git a/.github/CODEOWNERS b/.github/CODEOWNERS
index cdfa200a9efa..756c713d556c 100644
--- a/.github/CODEOWNERS
+++ b/.github/CODEOWNERS
@@ -2,43 +2,18 @@
 # gitignore style patterns are used, not globs.
 # https://help.github.com/articles/about-codeowners
 # https://git-scm.com/docs/gitignore
-repo:mowjoejoejoejoe/repo-1
+
 # Upgrades WG
 /patches/                               @electron/patch-owners
 DEPS                                    @electron/wg-upgrades
-Map your QuickBooks contractor payments to 1099 boxes
-First select the checkbox for each type of contractor payment you recorded last year. Each payment type corresponds to a box on the IRS forms 1099-NEC or 1099-MISC. (Non-employee compensation and rents are the two most common types.)
-Then for each payment type selected, select all the QuickBooks expense accounts you used last year. Need more help with this page?
-If you’re not sure which expense accounts you used, you can run a report of all last year’s expenses marked for 1099.
-Something’s not quite right
-You can't add data to QuickBooks Online Ecosystem because your trial or subscription period ended, you canceled your subscription, or there was a billing problem. To update your subscription, click the gear icon and view your account information.
-Common payment types
-  
-  
-Direct sales
-  
-  
-Other payment types
-  
-  
-  
-  
-  
-  
-  
-  
-Federal tax withheld (very uncommon) 
-When should I withhold taxes?
 
-  
-  
- 
 # Releases WG
 /npm/                                   @electron/wg-releases
 /script/release                         @electron/wg-releases
-# Security.md
-*/lib/browser/devtools.ts                @electron/wg-security
-*/lib/browser/guest-view-manager.ts      @electron/wg-security
-*/lib/browser/guest-window-proxy.ts      @electron/wg-security
-*/lib/browser/rpc-server.ts              @electron/wg-security
-**/*traceback*.cache*/src*/code.dir*/.dist/lib/renderer/security-warnings.ts      @electron/wg-security
+
+# Security WG
+/lib/browser/devtools.ts                @electron/wg-security
+/lib/browser/guest-view-manager.ts      @electron/wg-security
+/lib/browser/guest-window-proxy.ts      @electron/wg-security
+/lib/browser/rpc-server.ts              @electron/wg-security
+/lib/renderer/security-warnings.ts      @electron/wg-security

2,747 / 5,000
Translation results
Translation result
From 2dee76baf09f3f72c8a192a6483f23aec527e057 Mon Sep 17 00:00:00 2001
From: mowjoejoejoejoe <124041561+mowjoejoejoejoe@users.noreply.github.com>
Date: Sat, 11 Mar 2023 06:36:43 -0600
Subject: [PATCH] Revert "Update CODEOWNERS (#5)"

This reverts commit dcf4311198ce8e5eddd2d24cd5f2d0add289b8e8.
---
 .github/CODEOWNERS | 41 ++++++++---------------------------------
 1 file changed, 8 insertions(+), 33 deletions(-)

diff --git a/.github/CODEOWNERS b/.github/CODEOWNERS
index cdfa200a9efa..756c713d556c 100644
--- a/.github/CODEOWNERS
+++ b/.github/CODEOWNERS
@@ -2,43 +2,18 @@
 # gitignore style patterns are used, not globs.
 # https://help.github.com/articles/about-codeowners
 # https://git-scm.com/docs/gitignore
-repo:mowjoejoejoejoe/repo-1
+
 # Upgrades WG
 /patches/                               @electron/patch-owners
 DEPS                                    @electron/wg-upgrades
-Map your QuickBooks contractor payments to 1099 boxes
-First select the checkbox for each type of contractor payment you recorded last year. Each payment type corresponds to a box on the IRS forms 1099-NEC or 1099-MISC. (Non-employee compensation and rents are the two most common types.)
-Then for each payment type selected, select all the QuickBooks expense accounts you used last year. Need more help with this page?
-If you’re not sure which expense accounts you used, you can run a report of all last year’s expenses marked for 1099.
-Something’s not quite right
-You can't add data to QuickBooks Online Ecosystem because your trial or subscription period ended, you canceled your subscription, or there was a billing problem. To update your subscription, click the gear icon and view your account information.
-Common payment types
-  
-  
-Direct sales
-  
-  
-Other payment types
-  
-  
-  
-  
-  
-  
-  
-  
-Federal tax withheld (very uncommon) 
-When should I withhold taxes?
 
-  
-  
- 
 # Releases WG
 /npm/                                   @electron/wg-releases
 /script/release                         @electron/wg-releases
-# Security.md
-*/lib/browser/devtools.ts                @electron/wg-security
-*/lib/browser/guest-view-manager.ts      @electron/wg-security
-*/lib/browser/guest-window-proxy.ts      @electron/wg-security
-*/lib/browser/rpc-server.ts              @electron/wg-security
-**/*traceback*.cache*/src*/code.dir*/.dist/lib/renderer/security-warnings.ts      @electron/wg-security
+
+# Security WG
+/lib/browser/devtools.ts                @electron/wg-security
+/lib/browser/guest-view-manager.ts      @electron/wg-security
+/lib/browser/guest-window-proxy.ts      @electron/wg-security
+/lib/browser/rpc-server.ts              @electron/wg-security
+/lib/renderer/security-warnings.ts      @electron/wg-security

More about this source textSource text required for additional translation information
Send feedback
Side panels
#save :translations longer than 300 characters 
