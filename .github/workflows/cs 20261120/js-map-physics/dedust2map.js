/* ==========================================================================
   DE_DUST2 MAP GEOMETRY, TACTICAL CORNERS, POWER POSITIONS & TEAM ROUTES
   ========================================================================== */

export const MAP = {
    width: 2600,
    height: 2000,
    bgColor: "#cca878",
    siteA: { x: 1852, y: 39, w: 426, h: 448, safeSpot: { x: 2050, y: 135 }, label: "BOOM SITE A" },
    siteB: { x: 2093, y: 1450, w: 430, h: 512, safeSpot: { x: 2280, y: 1820 }, label: "BOMB SITE B" },
    spawnBoundsCT: { x1: 2254, y1: 821, x2: 2476, y2: 1099 },
    spawnBoundsT: { x1: 40, y1: 1400, x2: 380, y2: 2010 },

    shadedZones: [
        { x: 1456, y: 1393, w: 638, h: 567, name: "The Ant Hill" },
        { x: 1234, y: 1843, w: 224, h: 121, name: "New Subterranean Zone" }
    ],

    spawnsCT: [
        { x: 2310, y: 885 },
        { x: 2415, y: 885 },
        { x: 2365, y: 960 },
        { x: 2310, y: 1035 },
        { x: 2415, y: 1035 }
    ],

    spawnsT: [
        { x: 130, y: 1660 },
        { x: 260, y: 1480 },
        { x: 180, y: 1600 },
        { x: 260, y: 1600 },
        { x: 220, y: 1720 }
    ],

    areas: [
        { label: "Boom site A", x: 2065, y: 260 },
        { label: "Bomb site b", x: 2271, y: 1700 }
    ],

    crates: [],

    walls: [
        { x: 0, y: 0, w: 2600, h: 40, penetrable: false },
        { x: 0, y: 1960, w: 2600, h: 40, penetrable: false },
        { x: 0, y: 0, w: 40, h: 2000, penetrable: false },
        { x: 2560, y: 0, w: 40, h: 2000, penetrable: false },
        { x: 40, y: 400, w: 180, h: 90, penetrable: false },
        { x: 380, y: 400, w: 360, h: 90, penetrable: false },
        { x: 650, y: 490, w: 90, h: 320, penetrable: true },
        { x: 480, y: 1000, w: 320, h: 78, penetrable: true },
        { x: 710, y: 1170, w: 78, h: 340, penetrable: true },
        { x: 950, y: 400, w: 287, h: 90, penetrable: false },
        { x: 1460, y: 260, w: 90, h: 230, penetrable: true },
        { x: 950, y: 600, w: 78, h: 220, penetrable: true },
        { x: 950, y: 940, w: 78, h: 360, penetrable: true },
        { x: 1280, y: 600, w: 78, h: 420, penetrable: true },
        { x: 1280, y: 1140, w: 78, h: 307, penetrable: true },
        { x: 1850, y: 400, w: 160, h: 115, penetrable: false },
        { x: 1850, y: 570, w: 160, h: 110, penetrable: false },
        { x: 2065, y: 400, w: 105, h: 280, penetrable: false },
        { x: 2280, y: 40, w: 280, h: 90, penetrable: false },
        { x: 2280, y: 40, w: 280, h: 502, penetrable: false },
        { x: 1850, y: 820, w: 400, h: 90, penetrable: true },
        { x: 1850, y: 1050, w: 200, h: 45, penetrable: false },
        { x: 2522, y: 1392, w: 38, h: 567, penetrable: false },
        { x: 40, y: 1400, w: 120, h: 90, penetrable: true },
        { x: 360, y: 1400, w: 160, h: 90, penetrable: true },
        { x: 380, y: 1730, w: 140, h: 230, penetrable: true },
        { x: 1280, y: 1390, w: 377, h: 60, penetrable: false },
        { x: 1974, y: 1440, w: 120, h: 90, penetrable: false },
        { x: 1630, y: 1390, w: 60, h: 90, penetrable: false },
        { x: 1372, y: 1598, w: 235, h: 74, penetrable: false },
        { x: 1789, y: 1510, w: 60, h: 153, penetrable: false },
        { x: 1850, y: 1592, w: 241, h: 70, penetrable: false },
        { x: 1236, y: 1777, w: 260, h: 72, penetrable: false },
        { x: 1720, y: 1775, w: 95, h: 55, penetrable: false },
        { x: 1930, y: 1760, w: 155, h: 90, penetrable: false },
        { x: 1610, y: 1904, w: 520, h: 55, penetrable: false },
        { x: 1776, y: 1390, w: 420, h: 60, penetrable: false },
        { x: 1937, y: 180, w: 70, h: 70, penetrable: false },
        { x: 2088, y: 180, w: 70, h: 70, penetrable: false },
        { x: 2248, y: 1691, w: 70, h: 70, penetrable: false },
        { x: 2336, y: 1691, w: 70, h: 70, penetrable: false },
        { x: 810, y: 240, w: 70, h: 70, penetrable: false },
        { x: 1130, y: 920, w: 70, h: 70, penetrable: false },
        { x: 2248, y: 1605, w: 70, h: 70, penetrable: false },
        { x: 1280, y: 600, w: 435, h: 64, penetrable: true },
        { x: 1323, y: 400, w: 137, h: 90, penetrable: false },
        { x: 1516, y: 940, w: 71, h: 70, penetrable: false },
        { x: 1529, y: 1010, w: 47, h: 237, penetrable: true },
        { x: 1575, y: 1206, w: 733, h: 41, penetrable: true },
        { x: 994, y: 1548, w: 70, h: 70, penetrable: false },
        { x: 900, y: 1757, w: 70, h: 70, penetrable: false },
        { x: 2433, y: 1838, w: 17, h: 121, penetrable: false },
        { x: 2429, y: 1392, w: 131, h: 60, penetrable: false },
        { x: 2300, y: 1189, w: 71, h: 70, penetrable: false },
        { x: 1454, y: 756, w: 71, h: 70, penetrable: false }
    ]
};

export const TACTICAL_CORNERS = [
    // T Spawn, Garden & West Courtyard
    { x: 250, y: 1250, hotAngle: 0 },
    { x: 250, y: 920, hotAngle: 0 },
    { x: 580, y: 880, hotAngle: Math.PI / 4 },

    // A Long, A Long <-> A Short Gap & Extended Catwalk
    { x: 910, y: 200, hotAngle: 0 },
    { x: 830, y: 120, hotAngle: 0 },
    { x: 1280, y: 445, hotAngle: Math.PI / 2 },  // A Long <-> A Short wall gap
    { x: 1410, y: 180, hotAngle: 0 },
    { x: 1600, y: 180, hotAngle: 0 },
    { x: 1350, y: 545, hotAngle: 0 },
    { x: 1715, y: 542, hotAngle: 0 },            // Extended A Short catwalk mouth
    { x: 2038, y: 542, hotAngle: -Math.PI / 2 }, // A Short Site A doorway

    // Bombsite A (Twin Pillars & East Cubby; Room 2 sealed)
    { x: 1890, y: 180, hotAngle: Math.PI },
    { x: 2048, y: 215, hotAngle: Math.PI / 2 },
    { x: 2220, y: 175, hotAngle: Math.PI },
    { x: 2225, y: 540, hotAngle: -Math.PI / 2 }, // CT Ramp to Site A

    // Mid Courtyard, Upper-Mid Pillar, L-Bunker & Mid-to-Ant-Hill Connector
    { x: 1090, y: 1030, hotAngle: 0 },
    { x: 1290, y: 1020, hotAngle: 0 },
    { x: 1410, y: 790, hotAngle: Math.PI / 2 },  // Upper-Mid pillar west edge
    { x: 1565, y: 790, hotAngle: Math.PI / 2 },  // Upper-Mid pillar east edge
    { x: 1450, y: 1080, hotAngle: Math.PI },
    { x: 1490, y: 1145, hotAngle: Math.PI },     // Mid L-bunker west edge
    { x: 1755, y: 1165, hotAngle: Math.PI },     // Mid L-bunker east edge
    { x: 2435, y: 1225, hotAngle: Math.PI / 2 }, // East B-Doors corridor gap
    { x: 1733, y: 1420, hotAngle: Math.PI / 2 }, // Mid <-> Ant Hill north connector

    // Open West Maze Plaza, 3 East Maze Lanes & Widened Site B
    { x: 950, y: 1580, hotAngle: 0 },
    { x: 1020, y: 1720, hotAngle: 0 },
    { x: 1350, y: 1520, hotAngle: 0 },
    { x: 1665, y: 1715, hotAngle: 0 },           // Central Maze vertical cross-connector
    { x: 2040, y: 1561, hotAngle: 0 },           // Top Maze Lane east exit into Site B
    { x: 2050, y: 1712, hotAngle: 0 },           // Mid Maze Lane east exit into Site B
    { x: 2050, y: 1877, hotAngle: 0 },           // Bottom Maze Lane east exit into Site B
    { x: 2165, y: 1561, hotAngle: 0 },
    { x: 2165, y: 1715, hotAngle: 0 },
    { x: 2310, y: 1435, hotAngle: Math.PI / 2 }, // Widened B Doors center
    { x: 2486, y: 1820, hotAngle: -Math.PI / 2 } // Site B bottom-right cubby mouth
];

export const SITE_PATROL_POINTS = {
    A: [
        { x: 1890, y: 180 }, { x: 2050, y: 135 }, { x: 2048, y: 215 },
        { x: 2220, y: 175 }, { x: 2220, y: 340 }, { x: 2038, y: 350 }
    ],
    B: [
        { x: 2280, y: 1820 }, { x: 2165, y: 1715 }, { x: 2165, y: 1530 },
        { x: 2280, y: 1525 }, { x: 2464, y: 1680 }, { x: 2486, y: 1895 }
    ]
};

export const T_SITE_HOLD_ANGLES = {
    A: [
        // 1.5-2 px from East Wall (x=2280) & North Wall (y=40)
        { id: "T_HOLD_A_EAST_CUBBY", x: 2260, y: 60, watchX: 2050, watchY: 420 },
        // 1.5-2 px behind West Pillar (y=180)
        { id: "T_HOLD_A_WEST_PILLAR", x: 1972, y: 160, watchX: 1560, watchY: 180 },
        // 1.5-2 px behind A Short North Wall (y=400, x=2010)
        { id: "T_HOLD_A_SHORT_TUCK", x: 1990, y: 380, watchX: 2038, watchY: 535 },
        // 1.5-2 px behind East Pillar (y=180)
        { id: "T_HOLD_A_EAST_PILLAR", x: 2123, y: 160, watchX: 2225, watchY: 535 },
        // 1.5-2 px from North Wall (y=40) overlooking A Long
        { id: "T_HOLD_A_LONG_NORTH", x: 1750, y: 60, watchX: 1420, watchY: 180 }
    ],
    B: [
        // 1.5-2 px from Cubby Wall (x=2450) & South Wall (y=1960)
        { id: "T_HOLD_B_CUBBY", x: 2470, y: 1940, watchX: 2310, watchY: 1450 },
        // 1.5-2 px behind South-West Pillar (y=1761)
        { id: "T_HOLD_B_CRATE_SOUTH", x: 2283, y: 1781, watchX: 2340, watchY: 1440 },
        // 1.5-2 px inside NW Site B Wall corner (x=2094, y=1450)
        { id: "T_HOLD_B_NW_WALL", x: 2114, y: 1470, watchX: 2310, watchY: 1435 },
        // 1.5-2 px tucked behind Mid-Maze Divider (x=2091, y=1662)
        { id: "T_HOLD_B_MAZE_MID", x: 2111, y: 1682, watchX: 2290, watchY: 1460 },
        // 1.5-2 px from South Wall (y=1960)
        { id: "T_HOLD_B_SW_CORNER", x: 2165, y: 1940, watchX: 2310, watchY: 1480 }
    ]
};

export const T_POST_PLANT_ZONES = {
    A: {
        site: "A",
        pockets: [
            { id: "T_PP_A_EAST_CUBBY", x: 2260, y: 60, peekX: 2235, peekY: 235, watchX: 2050, watchY: 420, weight: 30 },
            { id: "T_PP_A_WEST_PILLAR", x: 1972, y: 160, peekX: 1915, peekY: 185, watchX: 1560, watchY: 180, weight: 28 },
            { id: "T_PP_A_SHORT_TUCK", x: 1990, y: 380, peekX: 2038, peekY: 365, watchX: 2038, watchY: 535, weight: 28 },
            { id: "T_PP_A_EAST_PILLAR", x: 2123, y: 160, peekX: 2220, peekY: 330, watchX: 2225, watchY: 535, weight: 26 },
            { id: "T_PP_A_LONG_PIT", x: 1410, y: 60, peekX: 1535, peekY: 150, watchX: 1860, watchY: 200, weight: 24 },
            { id: "T_PP_A_CATWALK_MOUTH", x: 1715, y: 510, peekX: 1790, peekY: 600, watchX: 2225, watchY: 540, weight: 22 }
        ]
    },
    B: {
        site: "B",
        pockets: [
            { id: "T_PP_B_CUBBY", x: 2470, y: 1940, peekX: 2475, peekY: 1810, watchX: 2310, watchY: 1450, weight: 30 },
            { id: "T_PP_B_CRATE_SOUTH", x: 2283, y: 1781, peekX: 2425, peekY: 1725, watchX: 2340, watchY: 1440, weight: 28 },
            { id: "T_PP_B_NW_WALL", x: 2114, y: 1470, peekX: 2215, peekY: 1525, watchX: 2310, watchY: 1435, weight: 28 },
            { id: "T_PP_B_MAZE_MID", x: 2111, y: 1682, peekX: 2050, peekY: 1712, watchX: 2290, watchY: 1460, weight: 26 },
            { id: "T_PP_B_CONNECTOR", x: 1710, y: 1410, peekX: 1810, peekY: 1320, watchX: 2245, watchY: 1320, weight: 24 },
            { id: "T_PP_B_SW_CORNER", x: 2165, y: 1940, peekX: 2165, peekY: 1800, watchX: 2310, watchY: 1480, weight: 22 }
        ]
    }
};

export const T_STRATEGIES = {
    // ----------------------------------------------------------------------
    // BOMBSITE A ATTACK STRATEGIES (All terminate strictly inside Site A)
    // ----------------------------------------------------------------------
    "DIRECT_A_LONG": {
        name: "GARDEN EXIT TO A LONG RUSH",
        targetSite: "A",
        isSplit: false,
        carrierRoute: [
            { x: 250, y: 1250 }, { x: 300, y: 445 }, { x: 910, y: 180 },
            { x: 1500, y: 150 }, { x: 2050, y: 135 }
        ],
        supportRoute: [
            { x: 250, y: 1250 }, { x: 300, y: 445 }, { x: 910, y: 180 },
            { x: 1600, y: 180 }, { x: 2220, y: 175 }
        ]
    },
    "GARDEN_A_SHORT": {
        name: "GARDEN EXIT TO A SHORT EXECUTE",
        targetSite: "A",
        isSplit: false,
        carrierRoute: [
            { x: 250, y: 1250 }, { x: 300, y: 445 }, { x: 910, y: 180 },
            { x: 910, y: 545 }, { x: 1350, y: 545 }, { x: 1715, y: 542 },
            { x: 2038, y: 450 }, { x: 2050, y: 135 }
        ],
        supportRoute: [
            { x: 250, y: 1250 }, { x: 300, y: 445 }, { x: 910, y: 180 },
            { x: 910, y: 545 }, { x: 1350, y: 545 }, { x: 1715, y: 542 },
            { x: 2038, y: 450 }, { x: 2220, y: 175 }
        ]
    },
    "TOP_MID_A_SHORT": {
        name: "WEST COURTYARD TO A SHORT RUSH",
        targetSite: "A",
        isSplit: false,
        carrierRoute: [
            { x: 580, y: 880 }, { x: 910, y: 880 }, { x: 910, y: 545 },
            { x: 1350, y: 545 }, { x: 1715, y: 542 }, { x: 2038, y: 450 },
            { x: 2050, y: 135 }
        ],
        supportRoute: [
            { x: 580, y: 880 }, { x: 910, y: 880 }, { x: 910, y: 545 },
            { x: 1350, y: 545 }, { x: 1715, y: 542 }, { x: 2038, y: 450 },
            { x: 2220, y: 175 }
        ]
    },
    "SPLIT_A": {
        name: "SPLIT A (GARDEN LONG & A SHORT)",
        targetSite: "A",
        isSplit: true,
        carrierRoute: [
            { x: 580, y: 880 }, { x: 910, y: 880 }, { x: 910, y: 545 },
            { x: 1350, y: 545 }, { x: 1715, y: 542 }, { x: 2038, y: 450 },
            { x: 2050, y: 135 }
        ],
        supportRoute: [
            { x: 250, y: 1250 }, { x: 300, y: 445 }, { x: 910, y: 180 },
            { x: 1600, y: 180 }, { x: 2220, y: 175 }
        ]
    },
    "SPLIT_A_LONG_GAP_SHORT": {
        name: "SPLIT A (A LONG WALL GAP TO A SHORT)",
        targetSite: "A",
        isSplit: true,
        carrierRoute: [
            { x: 250, y: 1250 }, { x: 300, y: 445 }, { x: 910, y: 180 },
            { x: 1280, y: 260 }, { x: 1280, y: 445 }, { x: 1350, y: 545 },
            { x: 1715, y: 542 }, { x: 2038, y: 450 }, { x: 2050, y: 135 }
        ],
        supportRoute: [
            { x: 250, y: 1250 }, { x: 300, y: 445 }, { x: 910, y: 180 },
            { x: 1500, y: 150 }, { x: 1890, y: 180 }
        ]
    },
    "A_SHORT_GAP_WRAP_LONG": {
        name: "A SHORT WALL GAP TO A LONG WRAP",
        targetSite: "A",
        isSplit: true,
        carrierRoute: [
            { x: 580, y: 880 }, { x: 910, y: 545 }, { x: 1280, y: 545 },
            { x: 1280, y: 445 }, { x: 1410, y: 180 }, { x: 1600, y: 180 },
            { x: 2050, y: 135 }
        ],
        supportRoute: [
            { x: 580, y: 880 }, { x: 910, y: 545 }, { x: 1350, y: 545 },
            { x: 1715, y: 542 }, { x: 2038, y: 450 }, { x: 2220, y: 175 }
        ]
    },
    "MID_TO_A": {
        name: "MID DOORS TO A SHORT & CT RAMP WRAP",
        targetSite: "A",
        isSplit: true,
        carrierRoute: [
            { x: 580, y: 880 }, { x: 1090, y: 1030 }, { x: 1320, y: 1080 },
            { x: 1755, y: 1120 }, { x: 1790, y: 740 }, { x: 2225, y: 740 },
            { x: 2225, y: 420 }, { x: 2220, y: 175 }
        ],
        supportRoute: [
            { x: 580, y: 880 }, { x: 910, y: 545 }, { x: 1350, y: 545 },
            { x: 1715, y: 542 }, { x: 2038, y: 450 }, { x: 2050, y: 135 }
        ]
    },
    "SPLIT_MID_CATWALK_A_SHORT": {
        name: "SPLIT MID DOORS TO CATWALK & A SHORT",
        targetSite: "A",
        isSplit: true,
        carrierRoute: [
            { x: 580, y: 880 }, { x: 1090, y: 1030 }, { x: 1320, y: 1080 },
            { x: 1755, y: 1120 }, { x: 1790, y: 740 }, { x: 1750, y: 542 },
            { x: 2038, y: 450 }, { x: 2050, y: 135 }
        ],
        supportRoute: [
            { x: 580, y: 880 }, { x: 910, y: 545 }, { x: 1350, y: 545 },
            { x: 1715, y: 542 }, { x: 2038, y: 450 }, { x: 2220, y: 175 }
        ]
    },

    // ----------------------------------------------------------------------
    // BOMBSITE B ATTACK STRATEGIES (Mid Doors & 3 East-Exiting Maze Lanes)
    // ----------------------------------------------------------------------
    "MID_TO_B_DOORS": {
        name: "MID DOORS TO WIDENED B DOORS RUSH",
        targetSite: "B",
        isSplit: false,
        carrierRoute: [
            { x: 580, y: 880 }, { x: 1090, y: 1030 }, { x: 1320, y: 1080 },
            { x: 1810, y: 1140 }, { x: 2435, y: 1160 }, { x: 2435, y: 1295 },
            { x: 2245, y: 1435 }, { x: 2280, y: 1820 }
        ],
        supportRoute: [
            { x: 580, y: 880 }, { x: 1090, y: 1030 }, { x: 1320, y: 1080 },
            { x: 1810, y: 1140 }, { x: 2435, y: 1160 }, { x: 2435, y: 1295 },
            { x: 2375, y: 1435 }, { x: 2464, y: 1680 }
        ]
    },
    "MID_CONNECTOR_MAZE_TOP_MID": {
        name: "MID DOORS TO MAZE (TOP & MID LANES)",
        targetSite: "B",
        isSplit: true,
        carrierRoute: [
            { x: 580, y: 880 }, { x: 1090, y: 1030 }, { x: 1320, y: 1080 },
            { x: 1470, y: 1280 }, { x: 1733, y: 1310 }, { x: 1733, y: 1420 },
            { x: 1733, y: 1485 }, { x: 1665, y: 1525 }, { x: 1665, y: 1715 },
            { x: 1880, y: 1712 }, { x: 2050, y: 1712 }, { x: 2165, y: 1715 },
            { x: 2280, y: 1820 }
        ],
        supportRoute: [
            { x: 580, y: 880 }, { x: 1090, y: 1030 }, { x: 1320, y: 1080 },
            { x: 1470, y: 1280 }, { x: 1733, y: 1310 }, { x: 1733, y: 1420 },
            { x: 1733, y: 1485 }, { x: 1910, y: 1485 }, { x: 1915, y: 1561 },
            { x: 2040, y: 1561 }, { x: 2165, y: 1561 }, { x: 2464, y: 1680 }
        ]
    },
    "MID_CONNECTOR_MAZE_BOTTOM": {
        name: "MID DOORS TO MAZE (BOTTOM & TOP LANES)",
        targetSite: "B",
        isSplit: true,
        carrierRoute: [
            { x: 580, y: 880 }, { x: 1090, y: 1030 }, { x: 1320, y: 1080 },
            { x: 1470, y: 1280 }, { x: 1733, y: 1310 }, { x: 1733, y: 1420 },
            { x: 1733, y: 1485 }, { x: 1665, y: 1525 }, { x: 1665, y: 1877 },
            { x: 1880, y: 1877 }, { x: 2050, y: 1877 }, { x: 2145, y: 1877 },
            { x: 2280, y: 1820 }
        ],
        supportRoute: [
            { x: 580, y: 880 }, { x: 1090, y: 1030 }, { x: 1320, y: 1080 },
            { x: 1470, y: 1280 }, { x: 1733, y: 1310 }, { x: 1733, y: 1420 },
            { x: 1733, y: 1485 }, { x: 1910, y: 1485 }, { x: 1915, y: 1561 },
            { x: 2040, y: 1561 }, { x: 2165, y: 1561 }, { x: 2486, y: 1895 }
        ]
    },
    "SPLIT_MID_MAZE_B_DOORS": {
        name: "SPLIT MID (MAZE CONNECTOR & WIDENED B DOORS)",
        targetSite: "B",
        isSplit: true,
        carrierRoute: [
            { x: 580, y: 880 }, { x: 1090, y: 1030 }, { x: 1320, y: 1080 },
            { x: 1470, y: 1280 }, { x: 1733, y: 1310 }, { x: 1733, y: 1420 },
            { x: 1733, y: 1485 }, { x: 1665, y: 1525 }, { x: 1665, y: 1715 },
            { x: 1880, y: 1712 }, { x: 2050, y: 1712 }, { x: 2165, y: 1715 },
            { x: 2280, y: 1820 }
        ],
        supportRoute: [
            { x: 580, y: 880 }, { x: 1090, y: 1030 }, { x: 1320, y: 1080 },
            { x: 1810, y: 1140 }, { x: 2435, y: 1160 }, { x: 2435, y: 1295 },
            { x: 2310, y: 1435 }, { x: 2280, y: 1525 }
        ]
    },
    "SPLIT_B_MID": {
        name: "SPLIT B (MID DOORS & BOTTOM MAZE LANE)",
        targetSite: "B",
        isSplit: true,
        carrierRoute: [
            { x: 580, y: 880 }, { x: 1090, y: 1030 }, { x: 1320, y: 1080 },
            { x: 1810, y: 1140 }, { x: 2435, y: 1160 }, { x: 2435, y: 1295 },
            { x: 2310, y: 1435 }, { x: 2280, y: 1820 }
        ],
        supportRoute: [
            { x: 1020, y: 1720 }, { x: 1120, y: 1900 }, { x: 1350, y: 1900 },
            { x: 1665, y: 1877 }, { x: 1880, y: 1877 }, { x: 2050, y: 1877 },
            { x: 2145, y: 1877 }, { x: 2280, y: 1820 }
        ]
    },
    "MAZE_TOP_LANE_RUSH": {
        name: "TOP MAZE LANE TO SITE B EXECUTE",
        targetSite: "B",
        isSplit: false,
        carrierRoute: [
            { x: 950, y: 1520 }, { x: 1350, y: 1520 }, { x: 1665, y: 1525 },
            { x: 1910, y: 1485 }, { x: 1915, y: 1561 }, { x: 2040, y: 1561 },
            { x: 2165, y: 1561 }, { x: 2280, y: 1820 }
        ],
        supportRoute: [
            { x: 950, y: 1520 }, { x: 1350, y: 1520 }, { x: 1665, y: 1525 },
            { x: 1910, y: 1485 }, { x: 1915, y: 1561 }, { x: 2040, y: 1561 },
            { x: 2165, y: 1561 }, { x: 2464, y: 1680 }
        ]
    },
    "MAZE_MID_LANE_RUSH": {
        name: "MID MAZE LANE TO SITE B EXECUTE",
        targetSite: "B",
        isSplit: false,
        carrierRoute: [
            { x: 950, y: 1580 }, { x: 1350, y: 1715 }, { x: 1665, y: 1715 },
            { x: 1880, y: 1712 }, { x: 2050, y: 1712 }, { x: 2165, y: 1715 },
            { x: 2280, y: 1820 }
        ],
        supportRoute: [
            { x: 950, y: 1580 }, { x: 1350, y: 1715 }, { x: 1665, y: 1715 },
            { x: 1880, y: 1712 }, { x: 2050, y: 1712 }, { x: 2165, y: 1715 },
            { x: 2464, y: 1680 }
        ]
    },
    "MAZE_BOTTOM_LANE_RUSH": {
        name: "BOTTOM MAZE LANE TO SITE B EXECUTE",
        targetSite: "B",
        isSplit: false,
        carrierRoute: [
            { x: 1020, y: 1720 }, { x: 1120, y: 1885 }, { x: 1350, y: 1900 },
            { x: 1665, y: 1877 }, { x: 1880, y: 1877 }, { x: 2050, y: 1877 },
            { x: 2145, y: 1877 }, { x: 2280, y: 1820 }
        ],
        supportRoute: [
            { x: 1020, y: 1720 }, { x: 1120, y: 1885 }, { x: 1350, y: 1900 },
            { x: 1665, y: 1877 }, { x: 1880, y: 1877 }, { x: 2050, y: 1877 },
            { x: 2145, y: 1877 }, { x: 2486, y: 1895 }
        ]
    },
    "MAZE_TOP_BOTTOM_PINCER": {
        name: "MAZE PINCER (TOP LANE & BOTTOM LANE)",
        targetSite: "B",
        isSplit: true,
        carrierRoute: [
            { x: 950, y: 1520 }, { x: 1350, y: 1520 }, { x: 1665, y: 1525 },
            { x: 1910, y: 1485 }, { x: 1915, y: 1561 }, { x: 2040, y: 1561 },
            { x: 2165, y: 1561 }, { x: 2280, y: 1820 }
        ],
        supportRoute: [
            { x: 1020, y: 1720 }, { x: 1120, y: 1885 }, { x: 1350, y: 1900 },
            { x: 1665, y: 1877 }, { x: 1880, y: 1877 }, { x: 2050, y: 1877 },
            { x: 2145, y: 1877 }, { x: 2486, y: 1895 }
        ]
    },
    "MAZE_MID_BOTTOM_PINCER": {
        name: "MAZE PINCER (MID LANE & BOTTOM LANE)",
        targetSite: "B",
        isSplit: true,
        carrierRoute: [
            { x: 950, y: 1580 }, { x: 1350, y: 1715 }, { x: 1665, y: 1715 },
            { x: 1880, y: 1712 }, { x: 2050, y: 1712 }, { x: 2165, y: 1715 },
            { x: 2280, y: 1820 }
        ],
        supportRoute: [
            { x: 1020, y: 1720 }, { x: 1120, y: 1885 }, { x: 1350, y: 1900 },
            { x: 1665, y: 1877 }, { x: 1880, y: 1877 }, { x: 2050, y: 1877 },
            { x: 2145, y: 1877 }, { x: 2486, y: 1895 }
        ]
    }
};

export const CT_STRATEGIES = {
    "PATROL_A": {
        name: "HOLD BOMBSITE A",
        type: "SITE",
        site: "A",
        route: [{ x: 1790, y: 860 }, { x: 2038, y: 720 }, { x: 2038, y: 542 }, { x: 1890, y: 180 }],
        patrolPoints: SITE_PATROL_POINTS.A
    },
    "PATROL_B": {
        name: "HOLD BOMBSITE B",
        type: "SITE",
        site: "B",
        route: [{ x: 2435, y: 1150 }, { x: 2435, y: 1295 }, { x: 2310, y: 1435 }, { x: 2165, y: 1715 }],
        patrolPoints: SITE_PATROL_POINTS.B
    },
    "MID_DOORS": {
        name: "HOLD MID DOORS",
        type: "PUSH",
        site: "MID",
        route: [{ x: 1450, y: 1080 }, { x: 1625, y: 1165 }],
        patrolPoints: [{ x: 1450, y: 1080 }, { x: 1490, y: 1145 }, { x: 1625, y: 1165 }, { x: 1565, y: 790 }]
    }
};

export const CT_DEFENSE_SPOTS = [
    { id: "A_LONG_CORNER", name: "A Long Corner", x: 1750, y: 180, angle: Math.PI, site: "A" },
    { id: "A_SITE_PILLAR", name: "Site A Twin Pillars", x: 2048, y: 215, angle: Math.PI, site: "A" },
    { id: "A_SHORT_DOOR", name: "A Short Site Door", x: 2038, y: 542, angle: Math.PI, site: "A" },
    { id: "A_EAST_CUBBY", name: "Site A East Cubby", x: 2220, y: 175, angle: Math.PI, site: "A" },
    { id: "B_DOOR_CHOKE", name: "B Wide Doors Watch", x: 2280, y: 1525, angle: -Math.PI / 2, site: "B" },
    { id: "B_ANT_HILL_CHOKE", name: "Ant Hill Exit Watch", x: 2060, y: 1715, angle: Math.PI, site: "B" },
    { id: "B_EAST_CUBBY", name: "Site B Back-Right Cubby", x: 2486, y: 1895, angle: -Math.PI * 0.65, site: "B" },
    { id: "MID_DOORS_WATCH", name: "Mid Bunker Overwatch", x: 1490, y: 1145, angle: Math.PI, site: "MID" }
];

export const AREA_CONTROL_ZONES = {
    MID: {
        site: "MID",
        pockets: [
            { id: "MID_NORTH_POCKET", x: 1415, y: 995, peekX: 1430, peekY: 1065, watchX: 1290, watchY: 1080 },
            { id: "MID_BUNKER_WEST_PEEK", x: 1605, y: 1165, peekX: 1490, peekY: 1145, watchX: 1290, watchY: 1080 },
            { id: "MID_UPPER_PILLAR_PEEK", x: 1434, y: 805, peekX: 1420, peekY: 875, watchX: 1385, watchY: 1080 }
        ]
    },
    A: {
        site: "A",
        pockets: [
            { id: "A_LONG_POCKET", x: 1760, y: 175, peekX: 1615, peekY: 175, watchX: 1280, watchY: 220 },
            { id: "A_SHORT_DOOR_POCKET", x: 2038, y: 542, peekX: 1875, peekY: 542, watchX: 1560, watchY: 542 },
            { id: "A_EAST_CUBBY_POCKET", x: 2220, y: 175, peekX: 2175, peekY: 215, watchX: 1920, watchY: 215 },
            { id: "A_TWIN_PILLAR_POCKET", x: 2048, y: 215, peekX: 2048, peekY: 285, watchX: 2038, watchY: 510 }
        ]
    },
    B: {
        site: "B",
        pockets: [
            { id: "B_MAZE_TOP_PEEK", laneGroup: "MAZE_TOP", x: 2114, y: 1514, peekX: 2050, peekY: 1561, watchX: 1880, watchY: 1561, weight: 32 },
            { id: "B_MAZE_MID_PEEK", laneGroup: "MAZE_MID", x: 2114, y: 1645, peekX: 2035, peekY: 1712, watchX: 1660, watchY: 1712, weight: 34 },
            { id: "B_MAZE_BOTTOM_PEEK", laneGroup: "MAZE_BOT", x: 2114, y: 1830, peekX: 2050, peekY: 1877, watchX: 1760, watchY: 1877, weight: 32 },
            { id: "B_DOORS_WEST", laneGroup: "B_DOORS_WEST", x: 2210, y: 1413, peekX: 2265, peekY: 1445, watchX: 2350, watchY: 1310, weight: 24 },
            { id: "B_DOORS_EAST", laneGroup: "B_DOORS_EAST", x: 2464, y: 1468, peekX: 2395, peekY: 1468, watchX: 2265, watchY: 1310, weight: 24 },
            { id: "B_BOTTOM_RIGHT_CUBBY", laneGroup: "B_CUBBY", x: 2486, y: 1895, peekX: 2486, peekY: 1805, watchX: 2260, watchY: 1760, weight: 20 }
        ]
    }
};

export const STRATEGIC_POWER_POSITIONS = [
    {
        id: "MID_DOORS_CT_SIDE",
        name: "Mid Bunker CT Overwatch",
        anchorX: 1490, anchorY: 1145,
        doorSeamX: 1290, doorSeamY: 1080,
        watchAngle: Math.PI,
        controlledZones: [{ x1: 950, y1: 850, x2: 1320, y2: 1320 }],
        teamBias: "CT"
    },
    {
        id: "MID_DOORS_T_SIDE",
        name: "Mid Doors T Courtyard Lock",
        anchorX: 1090, anchorY: 1030,
        doorSeamX: 1290, doorSeamY: 1080,
        watchAngle: 0,
        controlledZones: [{ x1: 1350, y1: 900, x2: 1750, y2: 1250 }],
        teamBias: "T"
    },
    {
        id: "A_LONG_SHORT_GAP_HOLD",
        name: "A Long / A Short Wall Gap Overwatch",
        anchorX: 1280, anchorY: 445,
        doorSeamX: 1280, doorSeamY: 260,
        watchAngle: -Math.PI / 2,
        controlledZones: [{ x1: 950, y1: 100, x2: 1450, y2: 390 }],
        teamBias: "ANY"
    },
    {
        id: "A_SHORT_CREST",
        name: "Extended A Short Catwalk Mouth",
        anchorX: 1715, anchorY: 542,
        doorSeamX: 1350, doorSeamY: 545,
        watchAngle: Math.PI,
        controlledZones: [{ x1: 1280, y1: 490, x2: 1715, y2: 600 }],
        teamBias: "CT"
    },
    {
        id: "A_SHORT_DOOR_HOLD",
        name: "Site A Short Doorway Hold",
        anchorX: 2038, anchorY: 542,
        doorSeamX: 1750, doorSeamY: 542,
        watchAngle: Math.PI,
        controlledZones: [{ x1: 1715, y1: 480, x2: 2060, y2: 620 }],
        teamBias: "CT"
    },
    {
        id: "A_EAST_CUBBY_HOLD",
        name: "Site A East Cubby Anchor",
        anchorX: 2220, anchorY: 175,
        doorSeamX: 2048, doorSeamY: 215,
        watchAngle: Math.PI,
        controlledZones: [{ x1: 1850, y1: 60, x2: 2240, y2: 390 }],
        teamBias: "CT"
    },
    {
        id: "B_DOORS_HOLD",
        name: "Site B Wide Doors Overwatch",
        anchorX: 2280, anchorY: 1525,
        doorSeamX: 2310, doorSeamY: 1435,
        watchAngle: -Math.PI / 2,
        controlledZones: [{ x1: 2180, y1: 1320, x2: 2435, y2: 1520 }],
        teamBias: "CT"
    }
];

export function isNearSpawn(x, y) {
    const distToCT = Math.hypot(x - 2365, y - 960);
    const distToT = Math.hypot(x - 230, y - 1500);
    return distToCT < 450 || distToT < 450;
}

export function isStrictlyInsideSite(x, y, site) {
    if (!site) return false;
    return x >= site.x && x <= site.x + site.w &&
           y >= site.y && y <= site.y + site.h;
}

export function isInsideExpandedSite(x, y, site) {
    if (!site) return false;
    const margin = 15;
    return x >= site.x - margin && x <= site.x + site.w + margin &&
           y >= site.y - margin && y <= site.y + site.h + margin;
}

export function getClosestRouteIndex(botX, botY, route) {
    if (!route || route.length === 0) return 0;
    let bestIndex = 0;
    let minDist = Infinity;
    for (let i = 0; i < route.length; i++) {
        const dist = Math.hypot(route[i].x - botX, route[i].y - botY);
        if (dist < minDist) {
            minDist = dist;
            bestIndex = i;
        }
    }
    return bestIndex;
}

export function getBotPowerPosition(bot) {
    for (const pos of STRATEGIC_POWER_POSITIONS) {
        const distToAnchor = Math.hypot(pos.anchorX - bot.x, pos.anchorY - bot.y);
        if (distToAnchor < 140) {
            return pos;
        }
    }
    return null;
}

export function isEnemyInControlledZone(powerPos, enemy) {
    if (!powerPos || !enemy) return false;
    return powerPos.controlledZones.some(zone =>
        enemy.x >= zone.x1 && enemy.x <= zone.x2 &&
        enemy.y >= zone.y1 && enemy.y <= zone.y2
    );
}