const { withAppDelegate, withInfoPlist, withPodfile } = require("@expo/config-plugins");

const hook = `
require_relative '../plugins/readany_mlx_ios'

post_integrate do |installer|
  configure_readany_mlx(installer)
end
`;

const scene = `

// iPadOS 27 requires a scene lifecycle. Keep Expo's app delegate and RN factory.
@objc(ReadAnyMLXSceneDelegate)
final class ReadAnyMLXSceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
             options: UIScene.ConnectionOptions) {
    guard let scene = scene as? UIWindowScene,
          let app = UIApplication.shared.delegate as? AppDelegate else { return }
    let window = UIWindow(windowScene: scene)
    self.window = window
    app.window = window
    var launchOptions: [UIApplication.LaunchOptionsKey: Any] = [:]
    if let url = options.urlContexts.first?.url {
      launchOptions[.url] = url
    }
    if let activity = options.userActivities.first {
      launchOptions[.userActivityDictionary] = [
        UIApplication.LaunchOptionsKey.userActivityType.rawValue: activity.activityType,
        "UIApplicationLaunchOptionsUserActivityKey": activity,
      ]
    }
    app.reactNativeFactory?.startReactNative(withModuleName: "main", in: window, launchOptions: launchOptions)
  }

  func scene(_ scene: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) {
    guard let app = UIApplication.shared.delegate as? AppDelegate else { return }
    for context in contexts {
      var options: [UIApplication.OpenURLOptionsKey: Any] = [.openInPlace: context.options.openInPlace]
      options[.sourceApplication] = context.options.sourceApplication
      options[.annotation] = context.options.annotation
      _ = app.application(.shared, open: context.url, options: options)
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    guard let app = UIApplication.shared.delegate as? AppDelegate else { return }
    _ = app.application(.shared, continue: userActivity, restorationHandler: { _ in })
  }
}
`;

module.exports = function withReadAnyMLX(config) {
  config = withInfoPlist(config, (result) => {
    result.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [{
          UISceneConfigurationName: "ReadAny MLX",
          UISceneDelegateClassName: "ReadAnyMLXSceneDelegate",
        }],
      },
    };
    return result;
  });
  config = withAppDelegate(config, (result) => {
    const source = result.modResults.contents;
    if (source.includes("final class ReadAnyMLXSceneDelegate")) return result;
    const legacyWindow = /#if os\(iOS\) \|\| os\(tvOS\)\n    window = UIWindow[\s\S]*?\n#endif\n/;
    if (!legacyWindow.test(source)) throw new Error("ReadAny MLX could not locate Expo's window creation.");
    result.modResults.contents = source.replace(legacyWindow, "") + scene;
    return result;
  });
  return withPodfile(config, (result) => {
    if (!result.modResults.contents.includes("configure_readany_mlx(installer)")) {
      result.modResults.contents += hook;
    }
    return result;
  });
};
