// The modules the prototype loads for Mar's proposal (UI Playground's
// own imports). Each one sets its <html> attribute or stylesheet at its
// default when it loads; storage is in memory here (main.ts), so the
// defaults are what they read.
import '../../look'
import '../uiTuner'
import '../palette'
import '../screen'
import '../cover'
import '../credits'
import '../homeBuilds'
import '../firstRun'
import '../shell/surface'
import '../shell/marShell'
import '../modes/modeStyle'
import '../brand/templateStyle'
import '../graph/graphStyle'
import '../assets/assetView'
import '../p20/p20'
import '../motion/tabSlide'
import '../looks/looks'
import '../pages/pageState'
import '../navOptions'
// Mar's look: the prototype loads it with MarBackdrop, always mounted in
// her proposal.
import '../shell/marShell.css'
import '../shell/borders.css'
import '../shell/panelsNav.css'
// The app loads it with MarBackdrop, under Mar's proposal.
import '../motion/motion.css'
import '../menus/layers.css'
