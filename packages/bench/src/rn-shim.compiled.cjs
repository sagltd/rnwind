/**
 * Minimal `react-native` stand-in for the bench runtime.
 *
 * The three libraries we compare all emit `<View style={…}>` trees. We
 * don't need the real RN view manager, Flow-typed internals, or Hermes
 * binding. A tiny set of forwarding host components + a pass-through
 * `StyleSheet.create` keeps the surface identical across rnwind,
 * nativewind, and uniwind so each library's generated code loads and
 * runs the same way.
 *
 * Emitted as plain CommonJS (`.cjs`) so Node's loader can require it
 * directly — neither the evaluated transform outputs nor the bench
 * code pay a compile step on the hot path.
 *
 * Any divergence from real RN biases one library over another; keep
 * this file boring and symmetric.
 */
'use strict'

const React = require('react')

function makeHost(tag) {
  const Forwarded = React.forwardRef(function Host(props, ref) {
    const merged = Object.assign({}, props, { ref: ref })
    return React.createElement(tag, merged, props.children)
  })
  Forwarded.displayName = tag
  return Forwarded
}

exports.View = makeHost('rn-view')
exports.Text = makeHost('rn-text')
exports.Pressable = makeHost('rn-pressable')
exports.TouchableOpacity = makeHost('rn-touchable')
exports.ScrollView = makeHost('rn-scroll')
exports.Image = makeHost('rn-image')
exports.SafeAreaView = makeHost('rn-safe')
exports.FlatList = makeHost('rn-flatlist')
exports.SectionList = makeHost('rn-sectionlist')
exports.TextInput = makeHost('rn-textinput')
exports.Switch = makeHost('rn-switch')
exports.ActivityIndicator = makeHost('rn-activity')
exports.KeyboardAvoidingView = makeHost('rn-keyboard')
exports.ImageBackground = makeHost('rn-imagebg')
exports.RefreshControl = makeHost('rn-refresh')
exports.TouchableHighlight = makeHost('rn-touchable-highlight')
exports.VirtualizedList = makeHost('rn-virtualized')
exports.Animated = {
  View: exports.View,
  Text: exports.Text,
  createAnimatedComponent: function (c) {
    return c
  },
  Value: function () {
    return { setValue: function () {} }
  },
}

exports.StyleSheet = {
  create: function (styles) {
    return styles
  },
  flatten: function (input) {
    if (Array.isArray(input)) return Object.assign.apply(Object, [{}].concat(input.filter(Boolean)))
    return input || {}
  },
  hairlineWidth: 1,
  absoluteFill: {},
  absoluteFillObject: {},
  compose: function (a, b) {
    return [a, b]
  },
}

exports.Platform = {
  OS: 'ios',
  select: function (obj) {
    return obj.ios || obj.default
  },
  Version: 17,
  isPad: false,
  isTV: false,
  isTesting: true,
}

exports.Dimensions = {
  get: function () {
    return { width: 390, height: 844, scale: 3, fontScale: 1 }
  },
  addEventListener: function () {
    return { remove: function () {} }
  },
}

exports.PixelRatio = {
  get: function () {
    return 3
  },
  getFontScale: function () {
    return 1
  },
  getPixelSizeForLayoutSize: function (n) {
    return n * 3
  },
  roundToNearestPixel: function (n) {
    return n
  },
}

exports.Appearance = {
  getColorScheme: function () {
    return 'light'
  },
  addChangeListener: function () {
    return { remove: function () {} }
  },
}

exports.useColorScheme = function () {
  return 'light'
}

exports.NativeModules = {}
exports.TurboModuleRegistry = {
  get: function () {
    return null
  },
  getEnforcing: function () {
    return {}
  },
}

exports.UIManager = {
  getViewManagerConfig: function () {
    return null
  },
  hasViewManagerConfig: function () {
    return false
  },
}

exports.I18nManager = {
  isRTL: false,
  getConstants: function () {
    return { isRTL: false, doLeftAndRightSwapInRTL: false }
  },
}

exports.findNodeHandle = function () {
  return 1
}

exports.default = exports
