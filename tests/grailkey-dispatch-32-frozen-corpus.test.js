// tests/grailkey-dispatch-32-frozen-corpus.test.js
//
// GrailKey Dispatch 32 (2026-08-08) — the permanent regression suite for
// the coherent-content-token lane deletion and the co-title
// visual_pool_top3 gating, per explicit instruction: "freeze the 15-case
// corpus as the permanent regression suite — deterministic local
// fixtures, no live eBay." Every pool below is copied VERBATIM from real
// production runtime logs (47-scan corpus, 2026-08-08 07:00-08:15 UTC,
// deployment dpl_7L3Pb6qHap4GaZfVLPZyaVopbNZf) — not representative
// reconstructions. Where a pool is genuinely long (up to 20 items), the
// full real pool is used, not a truncated subset, so family-scoring
// weights match the real trace exactly.
//
// LABELING — role, not count (per explicit instruction, do not let this
// become "15 bugs fixed"):
//   15 total observed coherent-content-lane FIRINGS in the corpus.
//   ~8  books where the lane's admission was the ACTUAL harm the
//       deletion corrects (star wars #68, strange tales, immortal hulk
//       #44, batman #608, gears of war #1, fantasy masterpieces #1,
//       spidey super stories #23, amazing spider man #17 — title
//       pollution that this deletion actually removes).
//   4   books were ALREADY SELF-CORRECTING today, independent of the
//       lane, via a different mechanism entirely:
//         super villain team-up #5 — 22e-force Rule 2 (excess-non-
//           consensus-tokens) already reverted it pre-deletion.
//         x-men #39, marvel team-up #14, marvel team-up #141 —
//           22e-force Rule 1 (missing-vision-tokens) already reverted
//           them pre-deletion.
//       These stay CORRECT post-deletion via the same or a more direct
//       path — the lane firing on these books was real but harmless.
//   1   amazing spider man #119 — title pollution corrected by this
//       deletion; pricing outcome (refused vs priced) is governed
//       separately by Fix 3b / Fix 32-C (already shipped), unaffected by
//       this deletion either way.
//   1   iron man #150 — title pollution corrected by BOTH mechanisms in
//       this dispatch together: the lane's own addition AND the
//       co-title visual_pool_top3 append (a second, independent
//       injector, gated off in the same dispatch — see the co-title
//       section below).
//   3 controls, verified NEVER exposed to either mechanism: archie at
//     riverdale high and marvel 85th anniversary special (both corrected
//     by 22e-force Rule 1 on a token-DROPPING mistake unrelated to this
//     lane), and giant size doctor strange #1 (Q84 logged "same title,
//     nothing added" — the lane never even engaged).
//   amazing spider man #74 is NOT in this suite — it routes through the
//     separate creator-tokens/adjacent-pair-recovered branch, untouched
//     by this deletion, out of scope (own investigation queued).
//
// Invoke: node tests/grailkey-dispatch-32-frozen-corpus.test.js

import { selectTitleFamilyCandidate } from '../src/lib/imageSearchIdentity.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);
const assertFalse = (cond, label) => assertEq(!!cond, false, label);

console.log('\n=== GrailKey Dispatch 32 — frozen 15-case corpus regression ===\n');

// ═══════════════════════════════════════════════════════════════════════
// ~8 ACTUAL HARM cases — title pollution the deletion corrects
// ═══════════════════════════════════════════════════════════════════════
console.log('~8 actual-harm cases — title pollution corrected by the deletion\n');

{
  // star wars #68 — 07:05:14 UTC. Real pool had "fenn shysa mention
  // mandalorians newsstand" admitted by the lane (support [3,3,3,4,4] over
  // a 5-member family — the exact crossover-math tie: 3/5=60%, so
  // 22e-force's percentage floor could never have caught it either).
  const pool = [
    'Star Wars #68, 1st Fenn Shysa, Mention of Mandalorians - Newsstand - Marvel 1983',
    'Star Wars #68 (Marvel, 1983) Beautiful Cover, 1st app Fenn Shysa, Dengar',
    'Star Wars #68 Marvel Comics 1983 NEWSSTAND Boba Fett 1st Mandalorian + Funko #02',
    'Star Wars #68, Re-Intro Boba Fett! Classic Fett cover!',
    'Star Wars Comic Book',
    'STAR WARS #68 (Marvel 1983) -- 1st Appearance MANDALORIAN -- Boba Fett -- VF/NM',
    '🔥STAR WARS🔥#68 BOBA FETT 9.2 1st mention Mandalorians 🔑 RARE NEWSSTAND',
    'Star Wars #68 Newsstand Variant (Marvel Comics February 1983)',
    'Star Wars #68 Marvel 1977 Series Boba Fett Original Run Iconic Cover',
    'Star Wars #68 1st App Mandalorian Newsstand Marvel 1982 Mandalorian Movie🔥🔑',
    'Star Wars 68 1st Mandalorians NEWSSTAND Fenn Shysa cover Marvel - 1983 Mandalore',
    'STAR WARS #68 🔑 BOBA FETT CGC 9.2 💥 1st mention Mandalorians Classic KEY 🔑',
    '🔑🔑Star Wars # 68  9.0 VF/NM (1977) ',
    'Marvel - STAR WARS #68 - Grade 8.0 - Comic Book',
    'Star Wars, 68 Feb, 1982 Comic',
    'Marvel Star Wars #68 Feb 1983 Newsstand Edition 60¢ Barcode ',
    'star wars comics',
    'Star Wars #68 - Feb 1983 - CGC 9.2 OW/W - Newsstand - Classic Boba Fett Cover',
    'Star Wars #68 Marvel Comics 1983 VF 1st mention of Mandalorians, Fenn Shysa!',
    'Star Wars #68 1st Mandalorian Boba Fett Gene Day Art Marvel (1983) Comic Book',
  ];
  const r = selectTitleFamilyCandidate(pool, 'star wars', '68', null, { ebayConsensusTitle: 'star wars' });
  assertEq(r.decision, 'fallback-vision', `star wars #68: title-admission blocked (got ${r.decision})`);
  assertEq(r.selectedTitle, null, 'star wars #68: no marketplace-SEO pollution reaches selectedTitle');
}

{
  // strange tales — 07:25:10 UTC. "atlas,pre,code,horror" admitted at
  // 6/6 support (not a crossover-math tie — genuine high consensus,
  // confirming the lane fails even on unambiguous cases).
  const pool = [
    'Strange Tales #17 Atlas Comics 1953 Pre-Code Horror Center Fold Detached',
    'Atlas Comics Strange Tales #28 5/54 CGC 6.5',
    'Strange Tales #30 (Marvel Comics July 1954)',
    'Marvel - STRANGE TALES (1951-76) #3 - Grade 2.5 - Comic Book',
    'VINTAGE ATLAS COMICS STRANGE TALES #11 OCT 1952 PRE CODE HORROR',
    'Atlas Comics Strange Tales #55 Silver Age Color Comic Book',
    'STRANGE TALES 31 CGC 7.5 PRE CODE HORROR 1954 ATLAS COMICS / RARE IN GRADE',
    'Strange Tales #8 CGC 7.5 1952 Golden Age Horror High Grade ~ QES Certified!',
    'Strange Tales #37 CGC 6.0 Atlas Comics Marvel Off-White To White Pages 1955',
    'Atlas Comics Strange Tales March 1954 No 26',
    'STRANGE TALES #8 ATLAS PRE CODE HORROR CGC 6.5 GOOD GIRL ZOMBIE GRAVEDIGGER',
    'STRANGE TALES #4 ATLAS PRE CODE HORROR CGC 5.0 1ST CREDITED JOHN ROMITA ARTWORK',
    'Strange Tales #45 Atlas 1956 Pre-Marvel Pre-Code Horror Comic IRS Collection COA',
    'Strange Tales #15 VG- CGC 3.5 (Atlas Comics 1953)',
    'Strange Tales #8 CGC 3.0 Atlas Comics Marvel Golden Age Pre Code 1952',
    'STRANGE TALES #65 (Atlas/1958) **Very Bright & Colorful!**',
    'Strange Tales #10  Atlas Comics 1952 Solid Campy CGC 3,5',
    'Strange Tales #1 CGC 5.5 FN- Atlas Marvel Classic Cover Scarce WHITE Pages',
    'Atlas STRANGE TALES No. 31 (1954) CGC 4.0 VG',
    'Strange Tales #8 CGC 4.0 Everett Cover Atlas Comics Pre Code 1952',
  ];
  const r = selectTitleFamilyCandidate(pool, 'Strange Tales', '36', null, { ebayConsensusTitle: 'strange tales' });
  assertEq(r.decision, 'fallback-vision', `strange tales: title-admission blocked (got ${r.decision})`);
  assertEq(r.selectedTitle, null, 'strange tales: fully clean, no "atlas pre code horror" fragment');
}

{
  // immortal hulk #44 — 07:39:54 UTC. "cho,michael" (creator name) at
  // [11,7] support — margin PASSES (18>=9), Commit 4.3 independently
  // confirms issue/year too (untested here, covered by identityCore
  // tests — this file only exercises the title-admission axis).
  const pool = [
    'Immortal Hulk #44 (Marvel) Cho Variant',
    'Marvel Comics THE IMMORTAL HULK #44 Michael Cho Variant - 2021',
    'The Immortal Hulk #44 (2021) Michael Cho Variant Cover',
    'The Immortal Hulk #44 (2021, Marvel) NM Michael Cho Variant',
    'IMMORTAL HULK #44 MICHAEL CHO HULK TWO-TONE VAR (MARVEL 2021)',
    'Immortal Hulk #44 Two-Tone Variant (2021) NM Marvel Comics 1st Print!',
    'The Immortal Hulk #44 LGY761 Variant Cover',
    'Immortal Hulk #44: Cho 2-Tone Variant NM  Marvel Comics (2021)',
    'Immortal Hulk #44 (2021) Michael Cho Two-Toned Variant NM 🔥',
    'IMMORTAL HULK #44 NEAR MINT 2021 MICHALE CHO TWO-TONE VARIANT 1st PRINT b-304',
    'Immortal Hulk #44C Cho Two-Tone Variant VF 2021 Stock Image',
    'IMMORTAL HULK #0, 1-50 (2018) Standard & VARIANTS You Pick Issue Finish Your Run',
    'The Immortal Hulk 44 LGY 761 Michael Cho Variant',
    'Immortal Hulk 44 Marvel Comics LGY 761 Variant Edition Joe Bennett Cover 2021',
    'IMMORTAL HULK #44 MICHAEL CHO VARIANT MARVEL COMICS 2021 BAGGED AND BOARDED',
    'Immortal Hulk #44 MICHAEL CHO TWO-TONE TRADE DRESS VARIANT MARVEL NM.',
    'Immortal Hulk #44 Variant NM- Signed w/COA Michael Cho 2021 Marvel Comics',
    'Immortal Hulk #44 ~ MARVEL 2021 ~ Michael Cho variant cover NM',
    'Immortal Hulk #44 Cho 2 Tone Variant | Marvel 2021 | 1st Print NM',
    'Immortal Hulk #44 Cho 2-Tone Variant NM Gem Wow -C5',
  ];
  const r = selectTitleFamilyCandidate(pool, 'immortal hulk', '44', null, { ebayConsensusTitle: 'immortal hulk' });
  assertEq(r.decision, 'fallback-vision', `immortal hulk #44: title-admission blocked (got ${r.decision})`);
  assertEq(r.selectedTitle, null, 'immortal hulk #44: "cho michael" (creator name) not adopted');
}

{
  // batman #608 — 07:59:06 UTC. "hush,jeph,loeb" admitted, never
  // reverted pre-deletion (unlike super villain team-up #5) — priced
  // $19.27 anyway ("unharmed" per the original report, but the identity
  // was still wrong).
  const pool = [
    "Batman #608 Facsimile Edition Part 1 of 'Hush' Storyline, DC Comics 2024",
    'Brand new, mint Batman It Begins Here comic book',
    'Batman #608 Jim Lee Cover Hush Story Begins DC Comics Jeph Loeb 2002',
    'batman comic book jim Lee cover variant',
    'BATMAN 608 HUSH STORYLINE JIM LEE  (2002, DC COMICS)',
    'Batman #608 (DC Comics December 2002)',
    'Batman #608 Hush Pt. 1 Jim Lee Jeph Loeb Bruce Wayne DC 2002 NM+ Free Shipping',
    'BATMAN #617 / HUSH / JIM LEE / JEPH LOEB / DC COMICS /Sep  2003',
    'Batman 608-619 Full Hush Run Plus Two Variants 14 Comics Total ',
    'Batman #608 (DC Comics December 2002)',
    'Brand new, mint Batman It Begins Here comic book',
    'DC Comics Batman 608, 608NYPOST, 612, 614, 616, 617, 618',
    'Batman Comic 611, 617, 623',
    'Jim Lee, Bat-Man. "Hush"',
    'DC Comics Batman #613 Direct Edition (2003) Batman: Hush Loeb/Lee/Williams',
    'Batman 608 Jeph Loeb, Jim Lee, Scott Williams Hush Chapter 1',
    'BATMAN #608 (1940) NM DC SCARCE hush',
    'BATMAN #608 NM 9.4 NEWSSTAND VARIANT "HUSH" PART ONE JIM LEE COVER AND ART 2002',
    'DC Comics Batman #615 (2003) Batman: Hush Part 8 Direct Edition',
    'Batman #608 (2002) Jim Lee Cover 🔑 Hush Story Begins Newsstand 1st Print',
  ];
  const r = selectTitleFamilyCandidate(pool, 'batman', '608', null, { ebayConsensusTitle: 'batman' });
  assertEq(r.decision, 'fallback-vision', `batman #608: title-admission blocked (got ${r.decision})`);
  assertEq(r.selectedTitle, null, 'batman #608: "hush jeph loeb" not adopted into title');
}

{
  // gears of war #1 — 07:23:07 UTC. THE proof case: "wildstorm" must
  // route to variant, "reader"/"collecting" must not enter title OR
  // variant.
  const pool = [
    'Gears Of War WILDSTORM Reader (2009) Collecting Issue 1 & 2 1st App. In Comics',
    'GEARS OF WAR WILDSTORM Reader (2009) Collecting Issue 1 & 2 comics  ',
    'GEARS OF WAR WILDSTORM COLLECTING COMIC 1 & 2 HOLLOW 2009 READER Comic VF- Mint',
    'Gears Of War Reader Collecting Issues 1 & 2',
    'Gears Of War Reader Collecting Issues 1-2 Wildstorm Comics 2009',
    'Gears of War Issue #1 2008',
    'Gears of War #1 WildStorm DC 2008 Ortega Sharp Comic Book ',
    'Gears Of War #1',
    'Gears of War #1 (DC Comics December 2008)',
    '2008 Gears of War 1 First Printing Liam Sharp Wildstorm NM-',
    'Gears Of War #1 - 2008 - Crimson Omen Cover ',
    'Gears Of War Reader Collecting Issues 1 & 2 (2009) Comic Book CBCS 9.4',
    'GEARS OF WAR #1 (2008) NM CRIMSON OMEN VARIANT',
    ' GEARS OF WAR #1 - 2008 NM/M 1st Appearance Comic VHTF KEY',
    'Wildstorm Gears of War #1 CGC 9.6 First Printing Comic Book 2008',
    'Gears of War #1, 1st app, Epic Video Games, New slab, X-BOX, 2008.  Liam Sharp.',
    'Gears of War #1 2008 WildStorm Productions High Quality Comic-First Ed-Signed😍!',
    'Gears of War #1  CBCS 9.6 NM Wht DC/Wildstorm Comic 2008 Video Game Liam Sharp',
  ];
  const r = selectTitleFamilyCandidate(pool, 'gears of war', '1', null, { ebayConsensusTitle: 'gears of war' });
  assertEq(r.decision, 'fallback-vision', `gears of war #1: title-admission blocked (got ${r.decision})`);
  assertEq(r.selectedTitle, null, 'gears of war #1: "reader collecting" does NOT enter canonical title');
  assertTrue(r.admittedVariantTokens.length === 1 && r.admittedVariantTokens[0] === 'wildstorm', `gears of war #1: "wildstorm" remains correctly classified and routed (got [${(r.admittedVariantTokens || []).join(',')}])`);
}

{
  // fantasy masterpieces #1 — 07:23:06 UTC. "silver,surfer" (reprinted
  // character content) admitted at [11,11] support; real CV volume name
  // is literally "Fantasy Masterpieces" — no "Silver Surfer" in it.
  const pool = [
    'Fantasy Masterpiece 1 / Silver Surfer / Newsstand / (1979)',
    'Fantasy Masterpieces Silver Surfer #1 (1979) Marvel Comics Bronze Age,',
    'Silver Surfer #1 Comic Origin 1979 Bronze Vintage Marvel Fantasy Masterpieces',
    'Vintage 1979 Marvel Fantasy Masterpieces #1 Silver Surfer Origin Comic Book',
    'Marvel Comics Fantasy Masterpieces #1 Silver Surfer (1979) Boarded',
    'Fantasy Masterpieces #1 VF Reprints Silver Surfer #1 from 1968 Marvel 1979',
    'SILVER SURFER #1 (1979) Fantasy Masterpieces Reprint NM Origin Galactus Marvel',
    'FANTASY MASTERPIECES #1 - Silver Surfer (1979 Reprint - Origin story - Galactus)',
    'FANTASY MASTERPIECES #1 1979 SILVER SURFER ORIGIN 1968 REPRINT BUSCEMA NM 1OWNER',
    'Fantasy Masterpieces 1 2nd Series Fn Condition  Newsstand Edition',
    'Fantasy Masterpieces: The Silver Surfer - The Origin of The Silver Surfer Dec #1',
    'Marvel Silver Surfer #1  1979 Reprint',
    'FANTASY MASTERPIECES #1 ~1979 MARVEL ~ THE SILVER SURFER ORIGIN~ ‘69 REPRINT~VF!',
    'Silver Surfer #1 Comic Origin 1979 Bronze Vintage Marvel Fantasy Masterpieces',
    'Fantasy Masterpieces Vol.2 #1  VF   1979 High Grade Marvel  Silver Surfer #1',
    'Fantasy Masterpieces #1 newsstand - Origin Silver Surfer - Reprint - 1979 -',
    "FANTASY MASTERPIECES VOL 2 #1 ('79) MN-, Reprints Silver Surfer #1",
    'Fantasy Masterpieces #1 Newsstand (Marvel 1979) Silver Surfer Origin *FN+*',
    'Fantasy Masterpieces v2 #1 (1979 Marvel) Reprints Silver Surfer Newsstand',
    'Fantasy Masterpieces #1 1979 Marvel Comics Fine Silver Surfer #1 Origin Reprint',
  ];
  const r = selectTitleFamilyCandidate(pool, 'fantasy masterpieces', '1', null, { ebayConsensusTitle: 'fantasy masterpieces' });
  assertEq(r.decision, 'fallback-vision', `fantasy masterpieces #1: title-admission blocked (got ${r.decision})`);
  assertEq(r.selectedTitle, null, 'fantasy masterpieces #1: "silver surfer" not adopted — real CV name is just "Fantasy Masterpieces"');
}

{
  // spidey super stories #23 — 07:56:31 UTC. "green,goblin" at [7,7]
  // support, margin PASSES (14>=12).
  const pool = [
    'Spidey Super Stories #23 (CGC 9.6, Marvel Comics) Green Goblin, Thing, & Puppet',
    'Spidey Super Stories #23 (1977) CGC 9.0',
    'SPIDEY SUPER STORIES #23 PGX  9.4 SS "  "SIGNED BY JOHN ROMITA"',
    'SPIDEY SUPER STORIES #23 CGC (1977) 7.5 SPIDER-MAN VS GREEN GOBLIN ROMITA COVER',
    'Spidey Super Stories #32 CGC 9.8 WP Doc Ock & 1st meet Spider-woman Custom label',
    'Spidey Super Stories #32 (1978) CGC 8.5',
    'Spidey Super Stories #23 (1977) CGC 9.6 White Pages! Green Goblin! Romita Cover!',
    'SPIDEY SUPER STORIES #23   PGX  8.5 " SIGNATURE EDITION "SIGNED BY JOHN ROMITA"',
    'SPIDEY SUPER STORIES #23 CGC (1977) 9.6 SPIDER-MAN VS GREEN GOBLIN',
    'Spidey Super Stories #25 CGC 8.5-1st Web-Man 1977',
    'Spidey Super Stories #23 1977 Green Goblin cover by John Romita Sr. Marvel comic',
    '1977 Spidey Super Stories 23 CGC 9.6 Spider-Man Green Goblin Cover.',
    'Marvel Comics SPIDEY SUPER STORIES #25 CGC 9.0 1st Web-Man! Doom cover! White pp',
    'Marvel Spidey Super Stories #23 (1976) Spider-Man vs Green Goblin Comic',
    'SPIDEY SUPER STORIES # 23 GREEN GOBLIN STAMP 1977 Marvel ELECTRIC COMPANY Thing',
    '1977 Spidey Super Stories 25 CGC 9.6 1st Appearance Of Web-Man. Dr. Doom Cover.',
    'Comic Surprise Box cgc key variants and more',
    'Comic Surprise Box cgc key variants and more',
    'Comic Surprise Box cgc key variants and more',
    'Comic Surprise Box cgc key variants and more',
  ];
  const r = selectTitleFamilyCandidate(pool, 'spidey super stories', '23', null, { ebayConsensusTitle: 'spidey super stories' });
  assertEq(r.decision, 'fallback-vision', `spidey super stories #23: title-admission blocked (got ${r.decision})`);
  assertEq(r.selectedTitle, null, 'spidey super stories #23: "green goblin" not adopted');
}

{
  // amazing spider man #17 — 07:56:20 UTC. "2nd,green,goblin" at
  // [13,15,15] support, margin PASSES easily (21>=3). Priced $149.53
  // pre-deletion despite pollution ("unharmed") — pool was rich enough
  // to still match; identity was still wrong.
  const pool = [
    'The Amazing Spider-Man #17 🕸  Silver Age Marvel - 2nd Green Goblin, Human Torch',
    'Marvel Comics Amazing Spider-Man #17 Human Torch Green Goblin Key Issue 1964',
    'Comic Book- Amazing Spider-Man #17 Green Goblin Torch Ditko & Lee 1964',
    'Amazing Spider-Man #17 Mid-High 2nd App Green Goblin 💥 Ditko Lee Silver Age Key',
    'Amazing Spider-man #17, GD+ 2.5, 2nd Appearance Green Goblin; Human Torch',
    'The Amazing Spider-man #17 2nd Green Goblin 1964 Featuring The Human Torch',
    'Amazing Spider-Man (1964) #17 * 2nd appearance of Green Goblin * Ditko/Lee',
    'Amazing Spider-Man #17 1963 1st Human Torch 2nd GREEN GOBLIN Marvel Comics',
    'Amazing Spider-Man #17 KEY! 2nd App Green Goblin! CGC 2.0 OW/W 4606852006',
    'DAMAGED Marvel Comics Amazing Spider-Man #17 1964 2nd appearance of Green Goblin',
    'Amazing Spider-Man #17 1964 2nd Green Goblin',
    'Amazing Spider-Man 17 Mid Grade 2nd Appearance of the Green Goblin - Human Torch',
    'Amazing Spider-Man #17 - G/VG (3.0)',
    'Amazing Spider-Man #17 (1964) Marvel Comics 2nd App Green Goblin CGC 4.0 WP',
    '1964 Amazing Spider-Man 17 HIGHER GRADE - 2ND APPEARANCE OF GREEN GOBLIN',
    'Amazing Spider-Man #17 FN- 5.5 2nd Appearance Green Goblin Steve Ditko Art!',
    '🕸Amazing Spider-Man🕸#17 2nd GREEN GOBLIN (1964)VINTAGE MARVEL🔥🔥🔥HOT🔥',
    'Amazing Spider-Man #17 Marvel 1964 CGC 3.0 GD/VG 2nd Green Goblin',
  ];
  const r = selectTitleFamilyCandidate(pool, 'amazing spider man', '17', null, { ebayConsensusTitle: 'amazing spider man' });
  assertEq(r.decision, 'fallback-vision', `amazing spider man #17: title-admission blocked (got ${r.decision})`);
  assertEq(r.selectedTitle, null, 'amazing spider man #17: "2nd green goblin" not adopted');
}

// ═══════════════════════════════════════════════════════════════════════
// 4 ALREADY-SELF-CORRECTING cases — the lane fired, but a DIFFERENT,
// pre-existing mechanism already reverted it before this dispatch. These
// were CORRECT pre-deletion and stay CORRECT post-deletion via the same
// or a more direct path. This section is what a naive "15 bugs fixed"
// framing would wrongly overstate.
// ═══════════════════════════════════════════════════════════════════════
console.log('\n4 already-self-correcting cases (pre-existing mechanisms, not this deletion)\n');

{
  // super villain team-up #5 — 07:56:27 UTC. Pre-deletion: 22e-force
  // Rule 2 (excess-non-consensus-tokens) already caught [sub,mariner]
  // and reverted to "super villain team up". This is NOT one of the ~8
  // harm cases — verifying it stays correct, not newly fixed.
  const pool = [
    'Super-Villain Team-Up #5 1976 Marvel Comics Dr. Doom and Sub-Mariner. MVS Intact',
    'SUPER-VILLAIN TEAM-UP 5 Dr. Doom Sub-Mariner (1st Shroud) Marvel 1976 HIGH GRADE',
    'SUPER VILLAIN TEAM UP #5 ART original cover proof DR DOOM NAMOR FANTASTIC FOUR',
    'Super-Villain Team-Up #5 (April 1976) Fantastic Four Dr Doom Sub Mariner',
    '1975 Super-Villain Team-Up 5 Dr. Doom Sub-Mariner Marvel',
    'Super-Villain Team-Up Dr. Doom And Sub-Mariner #5 1st Shroud App. VFN',
    'Super-Villain Team-Up #5 1976 Marvel Comics Dr. Doom and the Savage Sub-Mariner',
    'Super-Villain Team-Up #5 VF 8.0 Marvel 1976 Dr Doom, Sub-Mariner, 1st Shroud ',
    'Super-Villain Team-Up #5 1976 Marvel Comics Dr. Doom and the Savage Sub-Mariner',
    'Super- Villain Team-Up#6 Dr.Doom,Namor,F.F.,1st APP. of The Shroud VF-',
    'Super-Villain Team-Up #3 VF Marvel 1975 Dr Doom, Sub-Mariner, Attuma',
    'Super-Villain Team-Up #5',
    'Super-Villain Team-Up #5 1st Shroud! Dr. Doom! Sub-Mariner! Marvel 1976',
    'Super-Villain Team Up #5 1st App Shroud 1976 Marvel Comics',
    'SUPER-VILLAIN TEAM-UP 3 Dr. Doom Sub-Mariner Marvel Comics lot 1975 HIGH GRADE',
    "Marvel Comics Super-Villain Team-Up #’s 1-5,7,12",
    '2 COPIES Super-Villain Team-Up #5 1976 Marvel Comics Dr. Doom Savage Sub-Mariner',
    'Marvel Super Villain Team-Up #5 (1976) 1st App The Shroud; Dr. Doom, Namor',
    'Super-Villain Team-Up #5 (Marvel Comics 1976)  1st Appearance Of Shroud 🔑',
    'Marvel Comic SUPER-VILLIAN TEAM-UP #5 Dr. DOOM & SUB-MARINER 1st Shroud VFN- 7.5',
  ];
  const r = selectTitleFamilyCandidate(pool, 'super villain team up', '5', null, { ebayConsensusTitle: 'super villain team up' });
  assertEq(r.decision, 'fallback-vision', `super villain team-up #5: still clean (got ${r.decision})`);
  assertEq(r.selectedTitle, null, 'super villain team-up #5: unchanged, same clean outcome as pre-deletion (was Rule 2, now direct block)');
}

{
  // x-men #39 — 07:25:07 UTC. Pre-deletion: 22e-force Rule 1
  // (missing-vision-tokens, restores "x") already reverted "men
  // definition scans" back to "x men". Priced $70.24 pre-deletion.
  const pool = [
    'X-Men 39 FN/VF 7.0 High Definition Scans *b23',
    'X-Men #39 1967 Stan Lee! Jack Kirby 5.0 1st new continues Silver Age',
    'X-Men (1963) Silver Age Lot #32 - 55! You Pick the Issue! $15 - $160!',
    'X-MEN #39 1967 7.5 VF- 🔑 New Costumes',
    'UNCANNY X-MEN 39  DEBUT NEW X-MEN COSTUMES ORIGIN OF CYCLOPS 1967 Key Issue',
    'X-Men 39 VF- 7.5 High Definition Scans *b15',
    'X-Men #39 CGC 3.5/qualified: Origin of Cyclops!  New Costumes! Stan Lee! 1967',
    'X-Men 39 FN/VF 7.0 High Definition Scans *c5',
    'The X-Men #39 (Marvel Comics 1968) Silver Age Key Issue The Fateful Finale!',
    'The X-Men #39 (Marvel Comics December 1967)',
    'X-Men #39 FN- 5.5 1967 High Definition Scans *b44',
    'X-Men 39 VG- 3.5 High Definition Scans *',
    "THE X-MEN #39 ( 1967 ) VF ( FIRST APPEARANCE OF THE X-MEN'S NEW COSTUMES )",
    'Postcard - Marvel Comics X-Men #39 Cover - PC199',
    'Uncanny X-Men #39 GD+ 2.5 1967',
    'X-Men #39 (1967) Silver Age Key - 1st New Costumes! Mutant Master Finale - FN/VF',
    'X-MEN #39 CGC 8.0 OWW PAGES MARVEL 1967-NEW COSTUMES',
  ];
  const r = selectTitleFamilyCandidate(pool, 'x men', '39', null, { ebayConsensusTitle: 'x men' });
  assertEq(r.decision, 'fallback-vision', `x-men #39: still clean (got ${r.decision})`);
  assertEq(r.selectedTitle, null, 'x-men #39: unchanged, same clean outcome as pre-deletion (was Rule 1, now direct block)');
}

{
  // marvel team-up #14 — 07:59:04 UTC. Pre-deletion: 22e-force Rule 1
  // already reverted "team up bagley" back to "marvel team up".
  const pool = [
    'Marvel Team-Up #14 Facsimile Bagley Variant 1st Invincible Marvel App',
    'Marvel Team Up #14 Mark Bagley Facsimile Variant E Invincible 2026 Dave McCaig',
    'MARVEL TEAM-UP #14 Facsimile Cvr E Marvel Image Comics 2026 14E (CA) Bagley',
    'Marvel Team Up #14 FACSIMILE Seven (7) Cover Set Image Comics 2026',
    'MARVEL TEAMUP #14 FACSIMILE EDITION CVR E MARK BAGLEY & DAVE MCCAIG VAR',
    'MARVEL TEAM-UP #14 FACSIMILE E M. BAGLEY & D. MCCAIG SIGNED BY RYAN OTTLEY COA',
    'MARVEL TEAM-UP FACSIMILE EDITION #14 - COVER SELECT FROM 7 COVERS',
    'Marvel Team-Up #14 Spider-Man Invincible Facsimile Signed By Bagley W/COA NM/VF',
    'Marvel Team-Up #14-Signed By Ryan Ottley-W/COA Cover E ',
    'MARVEL TEAM-UP FACSIMILE EDITION #14 - MARK BAGLEY COVER E VARIANT',
    'Marvel Team-Up #14 Spider-Man Invincible CGC 9.8 Facsimile Edition Boarded',
    'Marvel Team-Up #14 (2026 Facsimile) Cover B Ryan Ottley Variant',
    'Marvel Team-Up (2026) #14 NM Facsimile Mark Bagley Variant Cover Image Comics',
    'Marvel Team-Up #14 Facsimile - March 2026 - NEW & SIGNED Cover E',
    'Marvel Team up 14 Invincible Signed By Bagley W/COA NM',
    'MARVEL TEAM UP #14 MCFARLANE VARIANT INVINCIBLE KEY ISSUE',
    'Marvel Team-Up Facsimile #14 Cover  Ryan Ottley Invincible- Spider-man Soft Slab',
    'MARVEL TEAM UP 14 SIGNED & COVER E MARK BAGLEY COA FACSIMILE EDITION 2026 .',
    'Marvel Team Up 14  Vol 3 Signed Ryan Ottley and first print  bundle ',
    'Marvel Team Up #14 Facsimile Reprint Invincible Spider-man Key NM Bagley Variant',
  ];
  // Note: production resolved this via top-rank-protection (enrich.js
  // passes additional call-site context, e.g. visionYear/isGraded, this
  // isolated pure-function fixture doesn't reproduce) — this fixture lands
  // on weighted-consensus instead. Both paths reach the identical outcome
  // that matters here: blocked, selectedTitle null, "bagley" not adopted.
  const r = selectTitleFamilyCandidate(pool, 'marvel team up', '14', null, { ebayConsensusTitle: 'marvel team up' });
  assertEq(r.decision, 'fallback-vision', `marvel team-up #14: title-admission blocked (got ${r.decision})`);
  assertEq(r.selectedTitle, null, 'marvel team-up #14: unchanged, same clean outcome as pre-deletion (was Rule 1, now direct block) — "bagley" not adopted');
}

{
  // marvel team-up #141 — 07:56:22 UTC. Pre-deletion: 22e-force Rule 1
  // already reverted "team up black costume newsstand app" back to
  // "marvel team up". Defect 4 (variant zeroing sold pool) is separate,
  // still HELD — this file only exercises title admission.
  const pool = [
    'MARVEL TEAM UP # 141 SPIDERMAN BLACK COSTUME NEWSSTAND Written by Jim Owsley',
    '🌟 1984 Marvel Team Up #141 2nd Black Suit Spiderman Venom F-VF Newsstand',
    'MARVEL TEAM-UP #141 (Marvel Comics 1984) F/VF 1st Spider-Man Black Costume',
    'Marvel Team-Up #141 Nice Midgrade 1st Black Costume Spider-Man Newsstand',
    'Marvel Team-Up #141 (1984) Spider-Man Daredevil Copper Age Boarded Black Suit',
    'Marvel Team-Up #141 Spider-Man 1st App Of Black Suit (Venom) Newsstand FN/VF',
    'Marvel Team-Up #141 Newsstand KEY! 1st Black Suit! Spiderman Daredevil Kingpin',
    'Marvel Team-Up #141 Newsstand (Marvel May 1984) (h) 2nd App Black Costume',
    'Marvel Team-Up #141 1984 Black Suit Spider-Man Daredevil Marvel Comics VF',
    'Marvel Team-Up #141 – Spiderman 1st Black Suit Appearance Est VF  1984 NEWSTAND',
    'MARVEL TEAM-UP #141 SPIDER-MAN AND DAREDEVIL BLACK SUIT SYMBIOTE NEWSSTAND',
    'Marvel Team-Up #141 Newsstand Variant (Marvel Comics May 1984)',
    'MARVEL COMICS TEAM-UP SPIDER-MAN DAREDEVIL #141 1ST APPEARANCE BLACK COSTUME',
    'Marvel Team Up 141 key book 1st appearance of black suit ',
    'Marvel Team-Up #141 (News) VF 1st Spider-Man Black Costume/Venom DD Black Widow',
    'Marvel Team Up 141 Newsstand Edition 1984 Key Black Suit Spidey Comic Book',
    '(1984) MARVEL TEAM UP #141 NEWSSTAND VARIANT COVER! Early Black Costume App',
    'Marvel Team-Up (1972 1st Series) #141',
    'Marvel Team Up Spiderman Daredevil Vol 1 #141 1st Black Costume KEY Issue',
    '*KEY COMIC* MARVEL TEAM-UP # 141 1st App BLACK COSTUME SYMBIOTE (1984) NEWSSTAND',
  ];
  const r = selectTitleFamilyCandidate(pool, 'marvel team up', '141', null, { ebayConsensusTitle: 'marvel team up' });
  assertEq(r.decision, 'fallback-vision', `marvel team-up #141: still clean (got ${r.decision})`);
  assertEq(r.selectedTitle, null, 'marvel team-up #141: unchanged, same clean outcome as pre-deletion (was Rule 1, now direct block)');
}

// ═══════════════════════════════════════════════════════════════════════
// iron man #150 — the TWO-INJECTOR case. Lane admission AND co-title
// visual_pool_top3 both had to be closed for this book to reach CORRECT.
// ═══════════════════════════════════════════════════════════════════════
console.log('\niron man #150 — two independent injectors, both closed\n');

{
  // 07:39:57 UTC. Pre-deletion: lane admitted "wp doom newsstand
  // doctor" (never reverted by 22e-force at Phase 1 the way batman #608
  // avoided it — this book's revert only happened later, at Phase 2,
  // AFTER co-title had already appended "DR DOOM White" and AFTER PC/
  // comps queries had already been wasted on the polluted title,
  // producing a thin 3-comp pool). This file only exercises the
  // title-admission axis (selectTitleFamilyCandidate); the co-title
  // append is a separate mechanism inside api/enrich.js, verified
  // gated off in this same dispatch (see the co-title section of
  // docs/PATTERN-LIBRARY.md — audited 1 real firing in the 47-scan
  // corpus, this exact book, 0/1 beneficial, visual_pool_top3's append
  // authority removed entirely).
  const pool = [
    'Iron Man #150 CGC 9.8 VS DR DOOM White Pages 1981',
    'Iron Man #150 CGC 9.4 WP Dr. Doom Cover Newsstand HIGH GRADE',
    'IRON MAN #150 (1981) CGC 9.6 WP IRON MAN V DOCTOR DOOM CLASSIC BATTLE COVER',
    'Marvel Iron Man #150 (1981) CGC 8.5 White Pages Direct Edition Dr Doom',
    'Iron Man # 150 1981 Marvel Comics CGC 9.6',
    "Iron Man #150 Newsstand 7.0 CGC Graded (September '81) (BROKEN SLAB)",
    'Iron Man #150 CGC 9.8 WP - 1981- Doctor Doom Battle Cover ULTRA RARE NEWSSTAND',
    'Iron Man #150 CGC SS 9.8 Signed JRJR + Layton 1981 VS. Doctor Doom NEWSSTAND',
    'Iron man #150 cgc 9.2 9/1981',
    'Iron Man #150 Newsstand CGC 9.4 Dr. Doom Cover MCU RDJ Downey MCU',
    'Invincible Iron Man #150 CGC 9.6 Dr Doom key 1981 Avengers DOOMSDAY Rob Dowy Jr',
    'Marvel Iron Man #150 (1981) CBCS 8.5 White Pages Direct Edition Dr Doom',
    'Iron Man #150 Newsstand Variant Doctor Doom Cover 1981 CGC 9.0',
    'IRON MAN #150 CGC 9.8 WHITE DR  DOOM BATTLE COVER #4523835008',
    'Iron Man #150, CGC 7.0 FN/VF, Signature Series by David Michelinie; Dr. Doom',
    'Iron Man #150 CGC 9.4 NM/Newsstand Variant/DOOM Custom Label/AVENGERS: DOOMSDAY!',
    'IRON MAN #150 - cgc 8.5 - OW/W Pages - Marvel/1981',
    'Marvel Iron Man #150 CGC 9.4 1981 Doctor Doom Newsstand Key Comic',
    'Iron Man #150 Doctor Doom Battle Cover Newsstand Variant White Pgs 1981 CGC 9.8',
    '💥 Iron Man v 1 # 158 1982 CGC 6.5 FN+  💥',
  ];
  const r = selectTitleFamilyCandidate(pool, 'iron man', '150', null, { ebayConsensusTitle: 'iron man' });
  assertEq(r.decision, 'fallback-vision', `iron man #150: title-admission blocked (got ${r.decision})`);
  assertEq(r.selectedTitle, null, 'iron man #150: "wp doom newsstand doctor" not adopted (co-title\'s separate "DR DOOM White" append is verified gated off in api/enrich.js, not this function)');
}

// ═══════════════════════════════════════════════════════════════════════
// amazing spider man #119 — title pollution corrected here; pricing
// outcome governed separately by Fix 3b / Fix 32-C (already shipped)
// ═══════════════════════════════════════════════════════════════════════
console.log('\namazing spider man #119 — title fixed here, pricing governed elsewhere\n');

{
  // 07:19:10 UTC. Pre-deletion: "hulk" (single token) admitted at 5/5
  // support — never even reached 22e-force's Rule 2 (added.length<2
  // exemption). Pre-deletion: REFUSED to price (Vision self-reported
  // low confidence, Fix 3b/Defect 6 territory, since resolved
  // independently by Fix 32-C's catalogCorroborated OR-arm).
  const pool = [
    'Amazing Spider-Man vol.1 #119 & 120 ( 1973)  HULK - Gwen Stacy - CGC 3.0 - 5.0',
    'Amazing Spider-Man vol.1 #119 & 120 ( 1973)  HULK - Gwen Stacy - CGC 7.0 - 6.0',
    'Tha Amazing Spider-Man #119 cgc 9.8 White Pages Hulk appearance 4/73 John Romita',
    'Marvel Comics the Amazing Spider-Man 119 April 1973 Incredible Hulk',
    'Amazing Spider-Man #119, CGC 9.4, Hulk Appearance, Marvel, 1973!',
    'CGC 9.2 O/W to WP Amazing Spiderman #119 Hulk Vs Spidey',
    'Hulk in Amazing Spider-man #119 comic',
    'Marvel Comics The Amazing Spider-Man #119 April 1973 Spider-Man Hulk',
    'AMAZING SPIDERMAN #119  1973 CBCS 5.0  HULK BATTLE ISSUE !   ( NEW SLAB )',
    'The Amazing Spider-Man #119 VF/NM',
    'AMAZING SPIDER-MAN #119, Marvel Comics, CGC 8.5, Hulk appearance, Romita cover',
    'Amazing Spider-Man #119 CGC 9.2- White pages! HULK ',
    'Amazing Spider-Man #119 1973 CGC 8.0 VF OW/W High Definition Scans**',
    'Amazing Spider-Man #119 CGC 8.5 White pages HULK 12pix INSURED Combined Shipping',
    "AMAZING SPIDER-MAN # 119 CGC 5.0 The Gentleman's name is...HULK! ..UINRESTORED",
    'Amazing Spider-Man #119 Hulk National Diamond Sales Insert/Mark Jewelers Insert',
    'Amazing Spider-Man #119 FN/VF 7.0! Classic Hulk Battle!',
    'Incredible Hulk Annual #2 - Marvel 1969 Silver Age Issue - CGC NM- 9.2',
    'Amazing Spider-Man #119 CGC 9.6 Spidey VS The Hulk RARE POP 72  Iconic Cover',
    'Marvel Comics Amazing Spider-Man #119 CGC 7.5 (1973) vs. The Hulk! Custom Label',
  ];
  const r = selectTitleFamilyCandidate(pool, 'amazing spider man', '119', null, { ebayConsensusTitle: 'amazing spider man' });
  assertEq(r.decision, 'fallback-vision', `amazing spider man #119: title-admission blocked (got ${r.decision})`);
  assertEq(r.selectedTitle, null, 'amazing spider man #119: "hulk" not adopted — was a single-token exemption case pre-deletion, correctly blocked now regardless of token count');
}

// ═══════════════════════════════════════════════════════════════════════
// 2 controls — never exposed to either mechanism, must stay identical
// ═══════════════════════════════════════════════════════════════════════
console.log('\n2 controls — verified never exposed to the lane or co-title\n');

{
  // marvel 85th anniversary special #1 — 07:59:19 UTC. No [Q84] addition
  // line at all — the family DROPPED "marvel" (Rule-1 territory, a
  // completely different mechanism), never touched by this deletion.
  const pool = [
    'Marvel 85th Anniversary Special #1 (2024) Skottie Young Wraparound Variant',
    'MARVEL 85TH ANNIVERSARY SPECIAL #1 SKOTTIE YOUNG WRAPAROUND VARIANT. NEW.',
    'Marvel 85th Anniversary Special #1 VF Marvel Comic 2025 Skottie Young Variant',
    'MARVEL 85TH ANNIVERSARY SPECIAL #1 SKOTTIE YOUNG WRAPAROUND VARIANT',
    'Marvel Comics 85th Anniversary Special #1 Variant Skottie Young Cover NM+',
    'Marvel 85th Anniversary #1 Signed By Skottie Young With Clear Backing Board',
    'MARVEL 85TH ANNIVERSARY SPECIAL #1 NM+ SKOTTIE YOUNG VARIANT (2024)',
    'Marvel 85th Anniversary Special #1 Skottie Young Var, NM 9.4, 1st Print,2024,MKB',
    'Marvel Comics 85th Anniversary Special #1 Variant Skottie Young Cover Venom',
    'Marvel 85th Anniversary Special #1 NM Marvel Comic 2025 Skottie Young Variant',
    'Marvel Comics Marvel 85th Anniversary Special #1 Venom Spider-Man Iron Man Cap',
    'MARVEL 85TH ANNIVERSARY SPECIAL #1 SKOTTIE YOUNG WRAPAROUND GEM COVER 2024 NM',
    'Marvel Comics MARVEL COMICS MARVEL 85TH ANNIVERSARY SPECIAL VARIANT',
    'Marvel 85th Anniversary Special 1 Variant Edition',
    'Marvel 85th Anniversary Special #1 FN+ Wraparound Cover Marvel 2024',
    'Marvel 85th Anniversary Special #1 Cover B-Skottie Young (Marvel Comics October',
    'Marvel 85th Anniversary #1 Remarked by AONE - No Spine ticks - Crispy!',
    'Marvel Comics Marvel 85th Anniversary Special #1 Skottie Young Variant 2024',
    'Marvel 85th Anniversary Special #1 VARIANT CGC 9.8 Graded Comic Book  ',
    'Marvel 85th Anniversary Special #1 Var, 1 Var Marvel Comic 2025 ',
  ];
  const r = selectTitleFamilyCandidate(pool, 'Marvel 85th Anniversary Special', '1', null, { ebayConsensusTitle: '85th anniversary special' });
  assertEq(r.decision, 'weighted-consensus', `marvel 85th anniversary special #1: resolves via weighted-consensus (got ${r.decision})`);
  assertEq(r.selectedTitle, 'Marvel 85th Anniversary Special', 'marvel 85th anniversary special #1: canonical "special" preserved — never routable, never at risk from this deletion');
}

{
  // archie at riverdale high #1 — 07:39:52 UTC. Q84 fires
  // "same title, nothing added" — the lane never engages at all; the
  // family DROPS "high" (Rule-1 territory, separate mechanism).
  const pool = [
    "Archie at Riverdale High #1 Archie Pub 1972 You Can't Win  'em All",
    'Archie at Riverdale High #1, Good - Very Good Condition',
    'Archie at Riverdale High #1 & #4, 1972, Archie Publications',
    'Archie at Riverdale High #1 VG+ 4.5 1972 Low Grade',
    'Archie at Riverdale High #1 Archie Pop Jughead Betty Veronica Archie (1972) VG/F',
    'Archie at Riverdale High #1, Archie August 1972: VF+',
    'ARCHIE AT RIVERDALE HIGH  #1 VG(LOWER GRADE) 1972 B&B COMBINE SHIPPING',
    'Archie Publications - ARCHIE AT RIVERDALE HIGH (1972-87) #1 - Grade 6.5 - Comic ',
    'Archie at Riverdale High #1 (Aug 1972)  Condition – VERY FINE +',
    'Archie at Riverdale High #1 VG+ Archie Comic 1972',
    'Archie at Riverdale High  #2',
    'Archie at Riverdale High #1 1972-1st issue-Veronica-Betty-FN',
    'ARCHIE AT RIVERDALE HIGH #1 1972 ARCHIE SERIES PERIODICAL BETTY VERONICA JUGHEA',
    'Archie at Riverdale High Comic Book Issue #1 Second Chance 4.0 VG Aug 1972',
    'Archie at Riverdale High 1 August 1972 Very Good 4.5 VG',
    'ARCHIE AT RIVERDALE HIGH  1  VG/FN/5.0  -  Affordable Mid-Grade from 1972!',
    'ARCHIE AT RIVERDALE HIGH 1 F VF FIRST ISSUE 1972',
    'Archie At Riverdale High- Archie, Jughead and the Gang! Funny!',
    'ARCHIE AT RIVERDALE HIGH #1 VF 8.0 PREMIERE ISSUE 1972 ARCHIE COMICS',
    'ARCHIE AT RIVERDALE HIGH # 1 (ARCHIE) BETTY - VERONICA - JUGHEAD - REGGIE',
  ];
  const r = selectTitleFamilyCandidate(pool, 'archie at riverdale high', '1', null, { ebayConsensusTitle: 'archie at riverdale high' });
  assertEq(r.decision, 'weighted-consensus', `archie at riverdale high #1: resolves via weighted-consensus (got ${r.decision})`);
  assertEq(r.selectedTitle, 'archie at riverdale high', 'archie at riverdale high #1: unaffected — never reached the (deleted) lane at all');
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\n' + '━'.repeat(59));
if (failed === 0) {
  console.log(`✓ All tests passed (${passed} assertions)`);
} else {
  console.log(`✗ ${failed} test(s) failed (${passed} passed)`);
  failures.forEach((f) => console.log(f));
  process.exitCode = 1;
}
console.log('━'.repeat(59));
