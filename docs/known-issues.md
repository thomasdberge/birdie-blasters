# Known issues

Layout problems that are known and not fixed yet. Each was found by scripted checks in headless Edge, which play a
seeded game at a given screen size and check that every control is on screen and clear of the others.

- **Short desktop windows when the mouse cannot be locked.** If the browser refuses to lock the mouse, the game falls
  back to dragging to aim and shows the touch controls (aim buttons and Fire). In a desktop window 560 px tall, the
  bullet choice of the assault rifle pushes them off the bottom of the screen (they are disabled then); 600 px is
  fine. At 520 px the golf bag also has to be scrolled to reach its last weapons, and at 437 px the aim buttons and
  Fire are off screen while aiming too.
- **Touch screens held sideways that are just over 500 px tall.** The sideways layout is for touch screens up to
  500 px tall; taller ones get the portrait-style HUD. A little above that, for example a 7-inch 1024×600 tablet in a
  browser (about 520 px of page), the golf bag has to be scrolled to reach its last weapons, and the bullet choice
  pushes the disabled aim buttons and Fire off the bottom. 900×510 has these problems; 960×540 and taller do not.
- **4-inch iPhones held sideways (568 px wide).** On an iPhone 5 or the first iPhone SE the golf bag has to be
  scrolled to reach its last weapons (by 7 px at 568×320, the whole second row at 568×270 with Safari's bars
  showing). At 568×270 the first hint, even the short one, is also cut off: there are only about 100 px between the
  aim buttons and Switch weapon. From 640 px wide, the short hint fits on every sideways screen.
