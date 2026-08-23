@mvp
Feature: Appearance
  As a visitor
  I want the familiar Alexandria palettes plus control over colors and fonts
  So that the library is readable from the first visit

  Background:
    Given named schemes antique, ocean, and forrest
    And every surface reads colors and fonts from tokens
    And Settings is /settings

  Scenario: Antique is the default and schemes persist
    When I open the site with no saved appearance
    Then Antique is active
    When I choose Ocean or Forrest in Settings
    Then those Alexandria tokens apply without a reload
    When I reopen the site
    Then the chosen scheme is still active with no flash of Antique

  Scenario: Anonymous visitors can customize
    Given I am not signed in
    When I set custom colors, UI font, reading font, and size
    Then the top bar and the rest of the UI use the UI font and custom colors
    And publication and wiki bodies use the reading font and size
    And the choices persist in this browser
    When I reset colors
    Then the active scheme tokens are restored

  Scenario: Settings is the appearance page
    When I open /settings
    Then I see scheme, colors, UI font, reading font, and size
