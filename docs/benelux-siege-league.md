# Benelux Siege League: plan, money and five-season simulation

A planning document, not a rulebook. Every figure here is a proposal or an estimate, to check
against real numbers. Nothing in it is built in Ligo yet, and nothing here changes a Ligo rule.
Settings Ligo would need are listed in section 15.

Written 16 November 2026, updated the same day after the discussion on market size.

## 1. Starting point

- **League:** a Benelux Rainbow Six Siege league (BSL), made and run by Ligo itself. Earliest
  start: Y12S2 or Y12S3 (2027).
- **Who may play:** at least 3 starters living in the Benelux, PC only, club based in the
  Benelux. Minimum age 16 is proposed (section 16); design doc O-31 says 18 today.
- **Market:** small. The Benelux Siege Cup, run by Benelux Siege Hub, got 7 teams out of the 16 it
  wanted, even with BESF support and a LAN final at Heroes World. **Expect 7–10 teams for
  Season 1**, until section 3 gives a better number.
- **Status:** the maintainer is not yet known in the Benelux scene and does not speak Dutch.
  No audience, no sponsor, no legal structure yet.
- **Ligo and the league are one organisation** (maintainer, 16 November 2026). Ligo's money can go
  straight into the league's prize pool. This conflicts with design doc section 18, where Ligo's
  surplus goes to _partnered_ leagues; the design doc is not changed yet (section 16).
- **Publisher licence:** Ubisoft's Community licence covers non-profit community tournaments
  with a prize pool of at most USD 10,000 and sponsor compensation of at most USD 10,000. Every
  figure here stays far below that. The full licence terms still need reading (section 14).

## 2. Is it worth it?

**As a business or a way to build a name: no.** 7–10 teams cannot fund real prizes, attract
real sponsors or justify a LAN.

**As Ligo's second league: possibly.** A league in another country and language proves Ligo
works beyond LFR, and gives Ligo something to show other organisers. Ligo automates most of the
running (registration, schedule, results, standings, images), so a small league costs little
staff time. LFR stays Ligo's first user: the league must not take time from the roadmap.

**Will it pull Benelux teams back from foreign leagues?** A little, and slowly. Grassroots teams
choose a league for a fair level, reliability and a schedule that suits them, not for the flag.
A home league pulls only with what foreign leagues cannot offer:

- **A LAN the teams can travel to** (Antwerp or Brussels, not Paris).
- **Their language.** LFR is French-speaking, so Dutch-speaking teams from Flanders and the
  Netherlands have no equivalent. They are the real market, more than the two Belgian teams
  already in LFR.
- **Local ties:** the BESF and a road towards national team selection.

A team can play both: O-29 forbids two rosters only in _the same_ competition, and many grassroots
teams welcome a second official match a week.

**Four seasons a year is right for teams:** a weekly official match all year round, at the right
level, is the product. The staff cost is what Ligo is built to remove.

## 3. Measure demand before building anything

In order of value:

1. **Ask Benelux Siege Hub** what they learned from the cup: why teams registered or not (date,
   price, format, or too few teams), and whether they would work together (section 11). The
   message to send is in section 11.1.
2. **Ask the BESF.** They funded that cup, see every Benelux project and know the pool of players
   for national team selection.
3. **Count unique teams in past events.** Go through Benelux R6 events of the last 1–2 years on
   Strave, Challengermode, FACEIT, start.gg and Liquipedia. Write down each team, its level and
   when it was last seen. Unique _active_ teams is the market; the cup shows how many of them
   actually register.
4. **Count Benelux teams in foreign leagues.** Rosters in LFR, other national leagues and
   EU-wide open events with Belgian, Dutch or Luxembourg players. These are the teams a home
   league might win over later.
5. **An interest form with no commitment,** posted in Benelux R6 Discords and communities.
   Expect about half of the "interested" teams to register.
6. **A go/no-go rule, set before starting:** launch the league if **8 or more teams commit**.
   Otherwise, help Benelux Siege Hub with Ligo for one more season, and measure again.

## 4. Format

### 4.1 Launch format: one division and an open qualifier

For 7–10 teams. Promotion and relegation need more teams than that.

- **One division of 8 teams,** single round robin (7 match weeks), then a playoff for the top 4.
- **Open qualifier cup** in the break before each season: league places 7 and 8 play it against
  any team that wants in; the top 2 of the cup take the league's two places. The league stays
  open to newcomers without a second division. The cup can be Benelux Siege Hub's (section 11).
- A double round robin (14 weeks) does not fit an R6 season (section 5).

### 4.2 Growth format: two divisions of 8

Only once about 14–16 teams want to play.

- Each division: single round robin (7 weeks).
- **1 team promoted and relegated directly, plus 1 barrage** (D1 7th v D2 2nd). Two direct moves
  and a barrage would change 3 teams out of 8 every season, so divisions would never settle.
- An 8-team playoff: D1 1st–6th and D2 1st–2nd.
- Rules against dropping on purpose: section 8.

### 4.3 Who may play: what to ease

Ease the eligibility rules that keep teams out for no good reason; never ease how rules are
enforced. Badly enforced rules are what make a league look amateur (the LFR's experience).

| Rule                                      | Proposal                                                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| At least 3 starters living in the Benelux | Keep: it is what makes the league Benelux. The Benelux Cup used the same rule                                    |
| Club based in the Benelux                 | Drop: the residency rule already covers it, and staff cannot check it                                            |
| Minimum age                               | 16 instead of 18 (section 16), as in the LFR                                                                     |
| PC only                                   | Keep: the competitive standard                                                                                   |
| Match day and time                        | Ease: let both captains pick any slot within the match week, with a default slot if they disagree                |
| Substitutes                               | Ease if teams ask: subs need not count towards the residency rule, as long as 3 Benelux players are on the field |

These are proposals; the questions to Benelux Siege Hub (section 11.1) may show which rules held
teams back.

### 4.4 The organiser playing in the league

The maintainer would like to play. It is possible, if no decision about the organiser's own team
is ever the organiser's:

- **Another staff member handles everything about that team:** disputes, forfeits, sanctions,
  roster approvals. With one organiser, that means recruiting at least one independent staff
  member first, ideally from another team or from Benelux Siege Hub.
- **Results are confirmed by the opponent,** as in the LFR (`result_validation: 'opponent'`), and
  every staff action is in Ligo's audit log.
- **Say it openly** on the league page: who plays where, and who rules on that team's matches.
- **Possibly not in Season 1,** while the league needs the organiser's full attention.

Ligo could support this with a setting that stops a staff member from acting on their own team's
matches. An idea, not a rule; it would need a decision and a place in the roadmap.

## 5. Calendar: one league season per R6 season

An R6 season lasts about 13 weeks. Four league seasons a year; the break is 2 weeks (maintainer,
16 November 2026).

| Weeks | What happens                                                                                                     |
| ----- | ---------------------------------------------------------------------------------------------------------------- |
| 1–2   | Break: new R6 patch, teams test it. Registration, fees, lineup lock. Open qualifier cup on the weekend of week 2 |
| 3–9   | Regular season: 7 match weeks, one match a week per team                                                         |
| 10–11 | Playoff: semi-finals, then the final                                                                             |
| 12–13 | Spare weeks: postponed matches, Ubisoft moving a season date, holidays                                           |

- **The spare weeks** absorb Ubisoft's dates, which can move; the schedule starts from Ubisoft's
  announced season launch.
- **Division size is capped by the calendar:** a round robin of 10 teams (9 weeks) still fits
  with a shorter spare; 12 teams (11 weeks) does not.
- The mid-season R6 patch lands around week 6 or 7, in the middle of the regular season.
- **University teams** (section 11) have exams in January and June and a summer break; expect
  them to skip one or two seasons a year.

## 6. Entry fees and discounts

### 6.1 Fees

20€ a season (80€ a year) is too much for small teams. Proposed:

| Season                  | Fee per team and season | A year    | Per player a year (5–7 players) |
| ----------------------- | ----------------------- | --------- | ------------------------------- |
| Season 1                | Free                    | —         | —                               |
| From Season 2, one div. | €10                     | €40       | €6–8                            |
| Two divisions (later)   | D1 €10, D2 €5           | €40 / €20 | €6–8 / €3–4                     |
| Open qualifier cup      | Free                    | —         | —                               |

Fees are paid in the break, by SEPA bank transfer (free in the eurozone). Card or app payments
cost about €0.25 + 1.5% each (design doc section 18).

### 6.2 Discount for showing up

A team that played every match of a season with no forfeit pays **half** the next season. In
Season 1 this is the "Founders" discount. The discount stays with the team only if it keeps at
least 3 of its starters (to decide: section 16).

### 6.3 Fees are not the funding

With 8 teams, €10 each and the discount, fees bring in about **€55 a season**. They make teams
show up; they do not pay prizes. The money comes from section 10: the maintainer's own €75 a
season, Ligo, the BESF, donations and, later, sponsors.

## 7. How the prize pool is split

### 7.1 One division

| Reward                     | Share                    |
| -------------------------- | ------------------------ |
| Playoff winner             | 45%                      |
| Playoff runner-up          | 25%                      |
| Regular season winner      | 20%                      |
| Regular season runner-up   | 10%                      |
| Open qualifier cup winners | A league place (no cash) |

Amounts are rounded to €5; rounding differences go to the playoff winner. Product prizes from
sponsors come on top. **The pool is announced before registration opens and never lowered
afterwards;** money that arrives later may only raise it.

### 7.2 Two divisions (later)

Most of the pool in the playoff, which both divisions enter; cash for the top of each table; the
D2 winner's prize capped by the overlap rule of section 8.

## 8. Keeping a weak Division 1 team from dropping on purpose

Applies to the two-division format only. The worry: a team that would finish low in D1 tanks,
drops, and wins money in D2 more easily.

1. **The overlap rule:** the D2 winner's cash prize is never above the lowest reward a D1 team
   earns by staying up. With a €10 D1 fee, that is a free D1 entry for places 3–6 (worth €10), and
   a D2 1st prize of at most €10.
2. **Winning D2 sends you back up,** so dropping on purpose wins D2 money at most once.
3. **D1 is the easy road to the big money:** most of the pool is in the playoff, where D1 sends 6
   teams and D2 only 2.
4. **The relegated team misses the playoff,** so tanking costs money now.
5. **Optional:** a team relegated from D1 cannot win D2 cash the next season (section 16).

**What Master Six League gets wrong here** (their published prizes): D1 pays €45 / €35 / €20 to
the top 3, and D2 pays €30 to its winner. A D1 team in 4th place or lower earns €0, while the D2
winner earns more than D1's 3rd. A weak D1 team earns more by dropping, winning D2 and coming
back. The overlap rule avoids this.

## 9. Five-season simulation (one division)

Five seasons is about 15 months. Sponsors, subsidies and bank costs run by the year; the tables
count each season's quarter of them.

### 9.1 Assumptions (expected case)

| Season | Teams | Fees | Sponsor cash | Donations | BESF subsidy | Ligo |
| ------ | ----- | ---- | ------------ | --------- | ------------ | ---- |
| 1      | 8     | €0   | €0           | €5        | €0           | €0   |
| 2      | 8     | €55  | €0           | €5        | €0           | €0   |
| 3      | 8     | €55  | €40          | €10       | €125         | €0   |
| 4      | 8     | €55  | €40          | €10       | €125         | €0   |
| 5      | 8     | €55  | €80          | €15       | €125         | €50  |

- **Fees:** 6 returning teams (5 with full attendance at €5, 1 at €10) and 2 new teams from the
  qualifier at €10.
- **Sponsors:** one local Partner (€160 a year) from Season 3, a second in Season 5 (section 10.1).
- **BESF:** about €500 for one year if granted, so €125 a season from Season 3.
- **Ligo:** nothing until the ASBL exists and earns more than hosting (section 10.3).
- **Costs:** about €10 a season in Season 2 (a separate account, payment fees), then about €25 a
  season with the ASBL's bank account. Founding the ASBL (about €200 once, to check) is a Ligo
  cost, outside the league's pool.
- **Not counted:** hosting, casters and graphics (volunteers and Ligo's images), a LAN, the
  qualifier cup (no cash).

### 9.2 Scenario A: no money from your own pocket

| Season | In   | Costs | **Prize pool** | Playoff 1st / 2nd | Regular season 1st / 2nd |
| ------ | ---- | ----- | -------------- | ----------------- | ------------------------ |
| 1      | €5   | €0    | **€0**         | Titles only       | Titles only              |
| 2      | €65  | €10   | **€55**        | €25 / €15         | €10 / €5                 |
| 3      | €230 | €25   | **€205**       | €95 / €50         | €40 / €20                |
| 4      | €230 | €25   | **€205**       | €95 / €50         | €40 / €20                |
| 5      | €325 | €25   | **€300**       | €135 / €75        | €60 / €30                |

Season 1's €5 carries into Season 2. Five seasons: **€765 paid out.** Without the subsidy,
sponsors or Ligo, the pool is €0, €55, €40, €40, €45: symbolic.

### 9.3 Scenario B: €75 of your own money every season

Decided by the maintainer on 16 November 2026: about €75 a season (about €300 a year), more or
less depending on the season, within the rule of section 7.1.

| Season | **Prize pool** | Playoff 1st / 2nd | Regular season 1st / 2nd |
| ------ | -------------- | ----------------- | ------------------------ |
| 1      | **€75**        | €35 / €20         | €15 / €5                 |
| 2      | **€130**       | €60 / €30         | €25 / €15                |
| 3      | **€280**       | €125 / €70        | €55 / €30                |
| 4      | **€280**       | €125 / €70        | €55 / €30                |
| 5      | **€375**       | €170 / €95        | €75 / €35                |

Five seasons: you spend **€375**, **€1,140 paid out.**

### 9.4 What it shows

- The pool stays small: €75–€375 a season. That is in line with Master Six League's €190 a
  season across three divisions, for a league a quarter of its size.
- Your €75 matters most in Seasons 1 and 2, before the BESF and sponsors.
- The BESF subsidy is the largest single source; it is worth applying for early.

## 10. Funding

### 10.1 Sponsors

Sold by the year (four seasons). A one-season trial is fine for a first deal. With 8 teams, only
the first two packages are realistic.

| Package         | A year (a season) | What the sponsor gets                                                                          |
| --------------- | ----------------- | ---------------------------------------------------------------------------------------------- |
| Partner         | €160 (€40)        | Logo on the league page and standings images, a sponsor channel in Discord, broadcast mentions |
| Product partner | In kind           | Their product as a prize, with the Partner visibility                                          |
| Prize partner   | €400 (€100)       | A prize named after them, logo on match images; once the league has two divisions              |

Sponsor logos on Ligo's images are a planned feature (design doc section 18), not built yet.

Who to ask (no one contacted; amounts are estimates for a league this size):

| Kind of sponsor                    | Examples                                  | Realistic ask a year                        |
| ---------------------------------- | ----------------------------------------- | ------------------------------------------- |
| Gaming cafés                       | Dothub (Antwerp), Gaming-Arena (Brussels) | €100–€300, or a discount on hosting a final |
| Local shops                        | PC repair shops, computer stores          | €100–€200                                   |
| Benelux PC and peripheral webshops | Megekko, Alternate, Azerty, Coolblue      | Products worth €100–€400                    |
| Esports apparel and print makers   | Small jersey makers, local print shops    | Jerseys for the champions or discount codes |
| Aim trainers and coaches           | Aim Lab, KovaaK's, R6 coaches             | Codes or coaching sessions                  |
| Telecoms, big hardware brands      | Orange Belgium, Proximus, HyperX          | Out of reach at this size                   |

### 10.2 Public money

| Source                                 | What it is                                                                                                                                                            | Amount                      |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| BESF Esports Events Incubator          | €5,000 in 2026 (National Lottery) for 5–10 smaller events with growth potential; new events or initiatives; at most two years; needs a plan to become self-sustaining | About €500–€1,000 per event |
| Cities, King Baudouin Foundation calls | Case by case                                                                                                                                                          | €250–€1,000                 |

The BESF also funded the Benelux Siege Cup and accepts many projects that show potential.
Applying also puts a federation's name next to the league's. Check whether a legal entity is
required.

### 10.3 Ligo's own money

Ligo and the league are one organisation, so Ligo's income can go into the prize pool. It stays
small for a while: nothing until the ASBL exists, then about €200–€400 a year above hosting.

- **Ads on the website:** about €40–€120 a year for the league's pages, with a cookie banner on
  every page. Recommended against: one Partner sponsor earns more.
- **Donations** with a "supporter" badge: about €80–€220 a year across all leagues.
- **League plans** paid by other organisers: about €120–€240 a year once 1–2 leagues pay.

**A trust problem to handle:** if other organisers pay Ligo and Ligo funds its own league's
prizes, part of their money ends up in a league that may compete with theirs. Two published
rules avoid that: money given _for the league_ goes to the league; general Ligo income follows a
published split (hosting, then the maintainer's pay, then prize pools). Design doc section 18
needs updating for this (section 16).

## 11. Recruitment and getting known

The organisers who launch well (Master Six League, for example) were already known in a scene.
The maintainer is not, so the plan borrows other people's trust.

- **Benelux Siege Hub first.** With 7–10 teams in the whole scene, two organisers chasing the same
  teams leave both half-empty. Working together: their cup becomes the league's open qualifier,
  the league gives their teams weekly matches between cups, Ligo provides stats and images for
  their events. They are also the most natural first organiser to use Ligo.
- **The BESF:** money, advice, and a name next to the league's.
- **A Flemish or Dutch co-organiser,** for outreach, casting and credibility in Flanders and the
  Netherlands. The league can work in English with pages translated into Dutch (design doc
  section 16), but people are recruited in their own language. Benelux Siege Hub's staff are a
  natural place to look.
- **University and college esports clubs** in Belgium and the Netherlands: their second and third
  teams are grassroots level with few official matches; €10 is nothing for a club, and the league
  gives it visibility and recruitment. Slow to reach, and exams cut into seasons.
- **One cup per R6 season,** not monthly: in the break, doubling as the open qualifier, or by
  co-hosting Benelux Siege Hub's cups (adding €25 to their pool, Ligo providing stats and
  images). A monthly €25 cup costs €300 a year and a weekend of staff work every month for the
  same 10 teams. Ligo does not build open-cup features (design doc section 1): the cup uses the
  league's bracket features, or runs elsewhere with Ligo's stats and images.
- **Discord outreach:** target organisers rather than single teams (one league or cup brings all
  its teams), ask a server's admin before posting, and show rather than pitch: a standings image
  or stat page from a team's own matches.
- **Twitter:** Ligo's progress, images and ideas, once the website is live. The first post with a
  link needs the domain and the VPS (CLAUDE.md hosting triggers).
- **Small creators and casters** who speak Dutch: hard to find; broadcast rights and VODs for
  their portfolio in exchange.

### 11.1 Message to Benelux Siege Hub

To send in English, from the maintainer, in a Discord DM or by e-mail:

> Hi! I'm [name], I build Ligo, a free platform for running esports leagues: registration,
> schedules, results, standings, stat pages and match images, with a Discord bot. It runs the
> LFR, the French R6 league.
>
> I've been following the Benelux Siege Cup, and the LAN final at Heroes World with the BESF's
> support looked great. I'm thinking about what a weekly Benelux league could look like, and
> you know the Benelux R6 scene far better than I do, so I'd love your view before I do
> anything.
>
> A few questions, if you have a moment:
>
> 1. What did you learn from organising the cup about Benelux teams? What made teams sign up,
>    and what held others back (the dates, the format, the level, something else)?
> 2. How many active Benelux teams do you think there are, at all levels?
> 3. Do you think teams would want a weekly league next to your cups, or is the scene too small
>    for both?
> 4. Would you be open to working together rather than running things side by side? For example,
>    your cup as the way into a league, or Ligo's stats and images for your events, free.
>
> No pressure at all, and happy to call if that's easier. Thanks!

### 11.2 Who to contact

Found online on 16 November 2026. Many sources are a few years old: check that each group still
exists before writing to it. **None of the student competitions found plays Rainbow Six Siege**
(they play Rocket League, League of Legends, Valorant, FIFA and others), so the pitch to a
student club is "start an R6 team, here is a league for it", not "bring your R6 team".

**Netherlands: student esports associations**

| Association                                       | Where                | Note                                                        |
| ------------------------------------------------- | -------------------- | ----------------------------------------------------------- |
| NBSE (Nederlandse Bond voor Studenten E-sports)   | National umbrella    | Best first contact: one message can reach every member club |
| DSEA (Delft Student Esports Association)          | TU Delft             | The oldest Dutch student esports association (2015)         |
| ESA Blueshell, and Esports Team Twente            | University of Twente | One of the largest; the university has an esports lounge    |
| Boosted Gryffins                                  | VU Amsterdam         | Plays in the Dutch College Esports Series                   |
| Het Duivelsei                                     | Leiden               | A general games association, not only esports               |
| Erasmus Esports                                   | Rotterdam            | Takes part in the Inter College Clash                       |
| ESEV Zephyr, WSG Paragon, TSEA Link, GEA Fairplay | City not confirmed   | Take part in the Inter College Clash                        |
| An esports association in Maastricht              | Maastricht           | Founded around 2022; name not found                         |

Teams also listed in the Inter College Clash: Northern Lions, Tilburg UNIted, Dorans Nijmegen,
which suggests clubs in Groningen or the north, Tilburg and Nijmegen.

**Belgium: student esports**

| Group                                                | Where                             | Note                                                                                  |
| ---------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------- |
| Belgian Student League                               | National competition              | Where Belgian university teams play; its games found are FIFA, Rocket League, CS, LoL |
| VUB Gaming                                           | VUB, Brussels                     | Works with the ULB's and EHB's clubs                                                  |
| UCLouvain CEFUC Gaming                               | UCLouvain FUCaM, Mons             | French-speaking; organises a yearly tournament                                        |
| Student teams at ULB, EHB, UGent, UHasselt, KdG, PXL | Brussels, Ghent, Hasselt, Antwerp | Played a Rocket League Winter Clash against VUB Gaming; club names not found          |

**Name clash:** the Belgian Student League is also "BSL". Use the full name, or another short
name, in Belgian student circles.

**Luxembourg**

| Group                                               | Note                                     |
| --------------------------------------------------- | ---------------------------------------- |
| LESF (Luxembourg Esports Federation)                | Non-profit, founded 2020                 |
| FLES (Fédération luxembourgeoise d'esport), fles.lu | Founded by people active in local gaming |

The scene is small enough that either federation may know every R6 team in the country.

**Federations and communities**

- **BESF** (Belgian Esports Federation) and **WalBru Esport** (French-speaking Belgium).
- **Nederlandse Esports Bond (ESB)**, listed by the IeSF as the Dutch federation.
- **Benelux Siege Hub:** a Discord community for R6 players in Belgium, the Netherlands and
  Luxembourg; runs the Benelux Siege Cup on Strave.

**R6 teams found**

Online search finds almost no grassroots R6 teams: they leave little trace outside Discord and
tournament pages. Found so far:

- **Clutch Rayn eSport,** Belgian, formed in March 2021; activity today unknown.
- **The Benelux Cup on Liquipedia** (Season 2, with Benelux residency for 3 of 5 players, two open
  qualifiers and 8 teams): its team list could not be read automatically; open it by hand.
- **The old Benelux League (ESL, about 2018–2021)** on siege.gg: its players and orgs (KV Mechelen
  Esports among them) may still play, often lower.

The rest comes from the manual search: asking the 6 Belgian teams who they scrim with, past
tournament team lists on Strave, Challengermode, FACEIT and start.gg, Dutch-language Discords,
Twitch filtered by Dutch, and X (section 3). Keep one spreadsheet: team, country, level, where
seen, last active, public contact, source.

## 12. A LAN final

Not in Season 1. Prices checked by the maintainer: Dothub (Antwerp) and Gaming-Arena (Brussels)
cost about €200 a day; Gaming-Arena can lend equipment, for more. Renting the whole café and
decorating it to look official costs more again.

- **When:** once a year at most, for a finals day with the top 2–4 teams, once the league has
  run for a year.
- **Cheaper first:** join the LAN Benelux Siege Hub already runs, rather than a separate event.
- **Funding:** a café sponsor's discount, the BESF, and a separate LAN budget, never the season's
  prize pool.

## 13. Comparison: Master Six League

Launched by people already known in their scene. About 40–50 teams played a placement bracket
(at least 3 matches each) and were then offered a paid seat in one of four divisions, or a seat
one division lower if they preferred.

|                       | Master Six League                                                                      | Benelux Siege League (proposed)         |
| --------------------- | -------------------------------------------------------------------------------------- | --------------------------------------- |
| Season                | 6–7 weeks                                                                              | 7 weeks + playoff, one per R6 season    |
| Fees per season       | D1 €15, D2 €10, D3 €5, D4 free, paid by Revolut by the end of week 3 of the off-season | €10 (one division); D1 €10, D2 €5 later |
| Regular season prizes | D1 €45/€35/€20, D2 €30/€20/€10, D3 €15/€10/€5                                          | Section 7                               |
| Teams                 | About 40–50                                                                            | 7–10 expected                           |

What to learn from them:

- **They sold the right level, not the prize.** Teams around 3.5–4.0 on a 0–10 scale have little
  made for them; a division of equal teams is worth more than cash.
- **The free placement bracket built trust before anyone paid,** and being offered a seat feels
  like accepting something earned. Choosing a lower seat keeps teams who would otherwise quit.
- **Looking clean works:** clear rules, regular posts, fast support. Ligo covers much of that.
- **Their fees pay their prizes because of their size:** about €300 in fees for €190 in prizes.
  At 8 teams that does not work.
- **Their prize table has the flaw of section 8.**

## 14. Legal and practical checks before money changes hands

- **Ubisoft licence:** read the full Community licence terms and register the league. Check the
  word "Siege" in the league's name and the use of Ubisoft's logos.
- **Structure:** Ligo's Belgian ASBL receives the money. Until it exists: a dedicated account
  with two signatories and a public ledger.
- **Paid entry and cash prizes:** a competition decided by skill is normally not a game of chance
  under Belgian or Dutch law; confirm with the Belgian Gaming Commission or a lawyer.
- **VAT and tax:** amounts this small should stay under the VAT exemption for small
  organisations; confirm when the ASBL is founded.
- **Players aged 16–17:** prize money is paid to the team captain only, who must be 18 or older
  or receive it through a parent's account. The digital consent age is 13 in Belgium and 16 in
  the Netherlands and Luxembourg, so 16-year-olds can sign up themselves.
- **Payouts** within two weeks of the final, by bank transfer, published in the ledger.

## 15. Settings Ligo would need (not to build now)

- an entry fee per division, and the attendance discount;
- a prize table in percentages with caps (the overlap rule);
- tracking who paid and which discount applies;
- an open qualifier that gives league places;
- season dates placed from an external calendar (the R6 season launch);
- sponsor slots on pages and images (design doc section 18);
- a public ledger page per league.

## 16. Decisions

**Decided (maintainer, 16 November 2026):**

- Four seasons a year, one per R6 season, with a 2-week break.
- About €75 a season of the maintainer's own money, more or less as needed.
- Ligo and the league are one organisation.

**Conflicts with the design doc, to settle before it is updated:**

- Ligo running its own league and funding its prizes (section 18 sends Ligo's surplus to
  partnered leagues), and the published split of section 10.3.
- Minimum age 16 instead of 18 for this league (O-31).

**Still open:**

1. Whether to launch at all: the go/no-go rule of section 3 (8 committed teams proposed).
2. Working with Benelux Siege Hub, and in what form.
3. Entry fees: €10 a season (proposed), and whether Season 1 is free.
4. The playoff and qualifier formats (sections 4 and 7), best-of.
5. How many starters a team keeps to keep its discount and place (3 proposed).
6. For two divisions: whether a team relegated from D1 can win D2 cash the next season.
7. Which eligibility rules to ease (section 4.3).
8. Whether the organiser plays, from which season, and who rules on that team (section 4.4).

## Sources

- Ubisoft, [Announcing our new tournament licensing platform](https://www.ubisoft.com/en-us/esports/rainbow-six/siege/news-updates/6fKNUaTIgh6rmOlBHPRslf/announcing-our-new-tournament-licensing-platform)
  and [Create your competition guide](https://www.ubisoft.com/en-eu/esports/rainbow-six/siege/page/5aVBFvcqShI128b0gRvc5L)
  (Community licence limits).
- BESF, [Esports Events Incubator 2026 subsidies](https://www.besf.be/news/eei/esports-events-incubator-2026-subsidies)
  and [Events incubator](https://www.besf.be/news/besf/events-incubator).
- [Master Six League](https://www.mastersixleague.com): fees, prizes and format as reported by the
  maintainer.
- Benelux Siege Cup (7 of 16 teams, BESF support, LAN final at Heroes World) and venue prices
  (Dothub, Gaming-Arena): reported by the maintainer.
- Orange Belgium, [sponsorship of Sector One and the GameForce Masters](https://corporate.orange.be/en/node/9591) (2019);
  Proximus, [eSportsONE](https://www.proximus.com/news/2020/20201113_proximus_to_broadcast_esportsone_channel.html) (2020).
- Student esports: TU Delft, [Delft Student Esports Association](https://www.tudelft.nl/en/onderwijs/praktische-zaken/studie-studentenverenigingen/verenigingen/delft-student-esports-association);
  University of Twente, [Esportslounge](https://www.utwente.nl/en/about-us/news-events-ceremonies/news/2021/6/1105283/esportslounge-at-university-of-twente)
  and [Esports Team Twente](https://www.utwente.nl/en/about-us/news-events-ceremonies/news/2021/3/1003528/esports-team-twente-is-making-great-progress);
  [VU Amsterdam, Ad Valvas](https://advalvas.vu.nl/en/student-society/violent-games-dont-make-you-violent/);
  [Leiden, Het Duivelsei](https://www.student.universiteitleiden.nl/en/news/2021/06/het-duivelsei-en);
  [Maastricht, Observant](https://www.observantonline.nl/english/Home/Articles/id/58263/new-esports-association-in-maastricht-takes-part-in-national-student-competition);
  [NBSE on Lanergy](https://student.lanergy.eu/organisation/2/Nederlandse-Bond-voor-Studenten-E-sports)
  and [Inter College Clash](https://student.lanergy.eu/icc);
  [VUB Gaming](https://www.vub.be/en/news/vub-students-establish-gaming-and-esports-association);
  [UCLouvain CEFUC](https://uclouvain.be/en/node/30515);
  [Belgian Student League on EsportsEarnings](https://www.esportsearnings.com/leagues/1216-belgian-student-league/countries).
- Luxembourg: [LESF](https://ten.gg/b/lesf) and [Luxtoday on Luxembourg's two federations](https://luxtoday.lu/en/luxembourg-en/luxembourg-esport-problems-of-recognition-and-organization).
- Nederlandse Esports Bond: [IeSF](https://oldsit3.iesf.org/?p=13468).
- R6 in the Benelux: [Benelux Cup Season 2 on Liquipedia](https://liquipedia.net/rainbowsix/Benelux/Cup/Season_2),
  [Clutch Rayn eSport on escorenews](https://escorenews.com/en/r6/team/clutch-rayn),
  [Benelux League Season 4 on siege.gg](https://siege.gg/news/1395-benelux-league-season-4-everything-you-need-to-know),
  [Benelux Siege Hub on top.gg](https://top.gg/api/discord/servers/851473532018782208).
- Design doc sections 1, 16 and 18; open questions O-29, O-31, M-24.
