@mvp
Feature: In-browser reader
  As a visitor
  I want to open a book page first, then read on demand
  So that I can see discussion without paying for the whole text up front

  Background:
    Given a readable edition with a table of contents and multiple 30041 sections
    And Mercury trees are used when GET /api/publications/:naddr/meta, /toc, and /stream exist for this naddr
    And /stream is NDJSON of pos-ordered wrappers (from/limit), including nested index headings and leaf kinds such as 30041 and 30023
    And HTTP tree events are verified before they are shown
    And Read always loads this page's 30040 (kind + pubkey + d-tag), never another pubkey's tree for the same d-tag

  Scenario: Sections wait for the button
    When I open the publication page
    Then I see the header and interaction lists
    And those lists are kind 34259 ratings for this edition's a-tag and kind 1111 / kind 1 threads
    And kind 9802 highlights are applied inline in section bodies once I read
    And I do not see section bodies
    And I see a "Read the publication" button when this edition is not tracked
    And when this edition is tracked I see "Continue reading" instead
    And Continue reading opens the reader at the tracked section (or pos), like Reading now on the home page
    And Continue reading clears comment, rating, and quote query params so the reader is not blocked by an earlier deep link
    And I see a book-and-check control to mark the edition as read (kind 1985 l=read), with a count of distinct readers
    And that read mark is never shown as a list label chip or landing label
    And under the metadata I see People rows for who labeled, bookmarked, highlighted, or shelved it when any exist
    And a People row Reading lists pubkeys whose kind 16374 queue includes this edition
    And the Labeled People row ignores l=read
    And when I am signed in I can add or remove list labels, bookshelf membership, and a bookmark for this edition
    When the header and social lists have fetched
    Then the site starts /meta, /toc, then /stream in the background
    And it does not walk a-tags while that tree exists
    When I leave before pressing the button
    Then that fetch is cancelled

  Scenario: Catalog stubs are not readable
    Given a 30040 with no section a-tags or e-tags (a copyright library card)
    When I open the publication page
    Then I see the header and interaction lists
    And I do not see a "Read the publication" button
    And I see that this is a catalog entry only
    And the site does not start /meta, /toc, or /stream for that edition

  Scenario: Nested 30040 indexes are readable
    Given a 30040 whose a-tags are only nested 30040 indexes (e.g. part/chapter trees)
    When I open the publication page
    Then I see a "Read the publication" button
    And pressing it walks those nested indexes for leaf sections

  Scenario: Non-30041 sections are still readable
    Given a 30040 whose a-tags include 30818, 30817, 11, 30023, or other non-30040 kinds
    Or whose children are e-tagged events
    When I open the publication page
    Then I see a "Read the publication" button
    And pressing it loads those section events in order

  Scenario: Read shows this naddr's tree
    When I press "Read the publication"
    Then the interaction lists are replaced by the reader
    And the URL includes read=1 so a refresh stays in the reader
    And I stay on /publication/d/{d}/p/{npub}
    And I see a "Publication info" button under the edition metadata
    When I press "Publication info"
    Then I see the header and interaction lists again
    And the URL no longer includes read=1
    When I press "Read the publication"
    Then the interaction lists are replaced by the reader
    And the ToC is Mercury /toc in pos order, or the document-stack fallback if this naddr has no tree
    And Mercury /toc lists nested 30040 indexes as headings (not every leaf section)
    And those nested indexes keep their titles and render indented by depth under their parent index
    And nested layers expand and collapse in the ToC (not a flat stack of buttons)
    And under any 30040, leaf sections are listed before nested 30040 indexes
    And the edition's own sections come before nested indexes in the ToC and reading pane
    And the top-level 30040 title is the first ToC link (jumps to the publication top) and the first reading-pane heading
    And basic edition metadata (authors, publisher, summary) appears under that top index heading
    And an index or section with an image tag shows that image as a hero above its heading
    And a Mercury index row with no event still shows as a titled heading in the ToC and reading pane
    And nested 30040 titles appear as headings in the reading pane (not only in the ToC)
    And ToC order stays fixed to that tree / 30040 order when jumping or loading more sections
    And each ToC label and reading-pane section header is that section's title-tag, else a human T-tag, else a human d-tag
    And the ToC is a nested outline of those titles (expandable where nested)
    And the ToC marks which index or section is currently in the reading pane
    And ancestors of that row stay expanded so the current location stays visible
    And a sticky Go to top control stays in view in the ToC on mobile and desktop and jumps to the edition start
    And clicking a ToC heading jumps to that section header
    And when that section has a hero image, the jump scrolls so the hero is visible above the heading
    And ToC entries whose section is not in the pane yet are shown disabled until that section loads
    And nested 30040 headings stay clickable so a jump can open that part
    And clicking a nested 30040 heading jumps to that index position in the stream
    And if that section is not in the pane yet, it is fetched and shown before waiting for the rest of the publication
    And the reader shows a short opening state for that section so the jump does not look inert
    And the first viewport is readable without the entire book
    And opening with read=1 paints the edition shell even if a background ToC prefetch is aborted
    When I scroll later
    Then subsequent sections appear in order
    And missing sections show a placeholder
    When I type into the page filter
    Then matching text in the section bodies is highlighted
    And the reader jumps to the first match
    And Enter moves to the next match

  Scenario: Resume position in this browser
    Given I have read into chapter 3
    When I leave and reopen the same edition on this device and press "Read the publication"
    Then I return near the last position
    When I refresh while reading
    Then I stay in the reader (via read=1) near that position
    And the reader paints a window around the focused section immediately, then keeps expanding until the whole stream is mounted
    And a complete Cache Storage stream snapshot is preferred over re-running Mercury
    And earlier chapters become available by scrolling up (or as idle fill expands the window backward on demand)

  Scenario: Track reading once the stream length is known
    Given I am signed in and reading a publication whose flattened section stream length is known
    When I press Track reading under the reader metadata
    Then a kind 16374 replaceable is published with this edition a-tag, pos, total, and optional section id
    And when Settings → Keep reading queue on this device only is on, Track writes the queue only in this browser instead
    And a progress bar shows pos over total while tracked
    And scrolling into a new section advances pos on 16374 (not only clicks)
    And scrolling upward or rereading an earlier section does not lower the tracked pos
    And live progress appears on Reading now and the progress bar immediately, and a signed 16374 publish runs within a few seconds of the first advance in a burst (further scrolls do not postpone that publish)
    And Reset tracking under the reader metadata sets the tracked pos back to 0
    And when Settings → Keep reading queue on this device only is on, those advances stay local and never publish 16374
    And Stop tracking removes the edition from 16374 without changing l=read
    When stream length is not yet known
    Then Track reading stays quiet with a loading hint
    When I mark a tracked edition as read (kind 1985 l=read)
    Then l=read is published first, then 16374 is republished without that book
    And a finish celebration asks whether to leave a rating
    And if a waiting book shifted into the active set its title is named
    And reaching the last section alone does not remove the book from 16374

  Scenario: Landing highlight deep-link opens the section first
    When I open /publication/d/{d}/p/{npub}?section={30041 address}&quote={excerpt}
    Then reading starts without pressing the button
    And that section is fetched and shown before the rest of /stream
    And the matching quote mark is scrolled into view

  Scenario: Markup is per section kind
    Given I am reading a 30040 whose children include several kinds
    Then 30041 is AsciiDoc
    And 30818 is AsciiDoc when the body has native AsciiDoc signals, otherwise Djot
    And wiki and section bodies are rendered as one markup document so listing and table blocks stay intact
    And citation macros and nostr: bech32 tokens become embeds after that render
    And 30817 and 30023 are Markdown
    And 11 is Djot falling back to Markdown
    And 20 and 21 use their dedicated cards
    And any other kind uses the generic card
