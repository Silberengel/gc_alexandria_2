@mvp
Feature: Routes
  As a visitor
  I want one set of paths
  So that every surface is reached the same way

  Scenario: App paths
    When I open one of:
      | path                         | result                                              |
      | /                            | landing                                             |
      | /search                      | global Nostr-event search results                   |
      | /p/{npub\|nprofile\|hex}     | profile                                             |
      | /publication/d/{d}           | disambiguation of matching top-level 30040 naddrs   |
      | /publication/d/{d}/p/{npub}  | that 30040                                          |
      | /publication/{naddr\|nevent} | that 30040; bar becomes /publication/d/{d}/p/{npub} |
      | /publication/naddr/{naddr}   | same as /publication/{naddr} (external linker form) |
      | /wiki/d/{d}                  | disambiguation of matching 30818 and 30817          |
      | /wiki/d/{d}/p/{npub}         | that wiki or spec page                              |
      | /wiki/{naddr\|nevent}        | that page; bar becomes /wiki/d/{d}/p/{npub}         |
      | /wiki/naddr/{naddr}          | same as /wiki/{naddr} (external linker form)        |
      | /settings                    | appearance and cache                                |
      | /about                       | About and getting started                           |
      | /contact                     | Contact when signed in; otherwise redirects to /    |
    Then that is the path for that surface

  Scenario: Path deep-links open the hash SPA
    When another site links to https://host/publication/naddr/{naddr} or /publication/{naddr} without a #/
    Then the app rewrites to /#/publication/{naddr} before the router mounts
    And the edition page opens instead of the landing page
    And /wiki/naddr/{naddr} and /p/{npub} path links rewrite the same way
