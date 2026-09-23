@mvp
Feature: Appearance
  As a visitor
  I want the familiar Alexandria palettes plus control over colors and fonts
  So that the library is readable from the first visit

  Background:
    Given named schemes antique, ocean, forrest, and gray
    And every surface reads colors and fonts from tokens
    And Settings is /settings

  Scenario: Antique is the default and schemes persist
    When I open the site with no saved appearance
    Then Antique is active
    When I choose Ocean, Forrest, or Soft Gray in Settings
    Then those Alexandria tokens apply without a reload
    When I reopen the site
    Then the chosen scheme is still active with no flash of Antique

  Scenario: Anonymous visitors can customize
    Given I am not signed in
    When I choose UI font, reading font, and text size from the Settings controls
    Then the top bar and the rest of the UI use the UI font
    And publication and wiki bodies use the reading font
    And text size sets the rem root so chrome, controls, and reading text all scale together
    And the choices persist in this browser
    When a custom primary color was saved and I reset colors
    Then the active scheme tokens are restored

  Scenario: Settings is the appearance page
    When I open /settings
    Then I see scheme swatches, dark mode, UI and reading font dropdowns, and text size
    And the active scheme control is marked selected (pressed)
    And toggles show a clear on state
    And I see Trust filter controls for GrapeRank minimum and on/off
    And Trust filter defaults to on with minimum 10
    And those Trust choices persist in this browser across Clear Cache
    And I see Books to read at once (default 3, range 1–10) under Reading
    And that concurrent limit persists in this browser and does not change kind 16374
    And I see Keep reading queue on this device only (off by default)
    And when that toggle is on, Track / progress / Stop write only to this browser and do not publish kind 16374
    And when that toggle is turned off again, the on-device queue is published as kind 16374 before leaving local-only
    And that local-only choice persists in this browser
