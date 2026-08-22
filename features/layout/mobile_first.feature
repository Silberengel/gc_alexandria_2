@mvp
Feature: Mobile-first layout
  As a reader on a phone, tablet, or laptop
  I want one layout that starts small and grows
  So that I never get a cramped desktop site or a phone column on a wide screen

  Scenario: One layout at every width
    When I open the site at a phone width
    Then each page is a usable single column
    And primary actions and comment threads do not require the page itself to scroll horizontally
    And each shelf may scroll horizontally inside its own shelf-bar
    When I widen to a tablet, then a laptop or desktop
    Then the catalog gains columns and the top bar fills the width
    And I do not switch information architecture
    And reading and wiki bodies keep a comfortable line length
    And the table of contents does not cover the only way back
