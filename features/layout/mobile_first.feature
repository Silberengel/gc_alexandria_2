@mvp
Feature: Mobile-first layout
  As a reader on a phone, tablet, or laptop
  I want one layout that starts small and grows
  So that I never get a cramped desktop site or a phone column on a wide screen

  Scenario: One layout at every width
    When I open the site at a phone width
    Then each page is a usable single column
    And the top bar stacks cleanly: brand and session on the first row, nav links on the next, search full-width when shown
    And primary actions and comment threads do not require the page itself to scroll horizontally
    And edition headers and the Details accordion wrap without forcing page-wide horizontal scroll
    And each shelf may scroll horizontally inside its own shelf-bar in full view
    When I widen to a tablet, then a laptop or desktop
    Then the catalog gains columns and the top bar fills the width
    And I do not switch information architecture
    And reading and wiki bodies keep a comfortable line length
    And on a phone the table of contents becomes a transparent icon at the bottom-right over the text
    And that icon opens the ToC in place and closes it again without covering the top bar
    And tapping or clicking outside the open ToC closes it
    And Highlights and What we are discussing sit in two columns
    And in full view search result cards grow to two, then up to three columns on a wide screen
    And compact grid listings use that same one / two / three column rhythm
    And full/compact/table layout icon buttons are available on home, search, and profile listings
