require 'fileutils'
require 'pathname'

def configure_readany_mlx(installer)
  expected_bundle = ENV.fetch('READANY_MLX_BUNDLE_ID', '').strip
  expected_bundle = 'com.readany.mlx.dev' if expected_bundle.empty?
  aggregate = installer.aggregate_targets.find do |candidate|
    candidate.user_targets.any? do |target|
      target.build_configurations.any? { |config| config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] == expected_bundle }
    end
  end
  raise 'ReadAny MLX requires its isolated development Bundle ID' unless aggregate

  project = aggregate.user_project
  target = aggregate.user_targets.find { |candidate| candidate.product_type == 'com.apple.product-type.application' }
  base = Pathname.new(project.project_dir)
  module_dir = base.dirname.join('modules/readany-mlx-embedding')
  objects = Xcodeproj::Project::Object
  relative = module_dir.join('runtime').relative_path_from(base).to_s
  package = project.root_object.package_references.find do |reference|
    reference.isa == 'XCLocalSwiftPackageReference' && reference.relative_path == relative
  end
  unless package
    package = project.new(objects::XCLocalSwiftPackageReference)
    package.relative_path = relative
    project.root_object.package_references << package
  end
  unless target.package_product_dependencies.any? { |dependency| dependency.product_name == 'Qwen3Embedding' }
    product = project.new(objects::XCSwiftPackageProductDependency)
    product.product_name = 'Qwen3Embedding'
    target.package_product_dependencies << product
    build_file = project.new(objects::PBXBuildFile)
    build_file.product_ref = product
    target.frameworks_build_phase.files << build_file
  end

  source = module_dir.join('backend/ReadAnyQwen3Backend.swift').relative_path_from(base).to_s
  unless target.source_build_phase.files_references.any? { |reference| reference&.path == source }
    target.add_file_references([project.main_group.new_file(source)])
  end

  workspaces = [
    base.join(project.path.basename, 'project.xcworkspace'),
    base.join("#{project.path.basename('.xcodeproj')}.xcworkspace")
  ]
  workspaces.each do |workspace|
    lock = workspace.join('xcshareddata/swiftpm/Package.resolved')
    next if lock.exist?
    lock.dirname.mkpath
    FileUtils.cp(module_dir.join('runtime/Package.resolved'), lock)
  end
  configure_readany_mlx_bundle(target)
  project.save

  installer.pods_project.targets.each do |pod|
    pod.build_configurations.each do |config|
      version = config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
      if version && Gem::Version.correct?(version) && Gem::Version.new(version) < Gem::Version.new('15.1')
        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'
      end
    end
    if pod.name == 'EXConstants'
      constants = pod.shell_script_build_phases.find { |phase| phase.name&.include?('Generate app.config') }
      if constants
        constants.shell_script = <<~'SH'
          set -e
          scripts="${PODS_TARGET_SRCROOT}/../scripts"
          "${scripts}/with-node.sh" "${scripts}/getAppConfig.js" "${PODS_ROOT}/../.." "${CONFIGURATION_BUILD_DIR}/EXConstants.bundle"
        SH
      end
    end
    next unless pod.name == 'ReactNativeStaticServer'
    pod.shell_script_build_phases.each do |phase|
      phase.shell_script = phase.shell_script
        .gsub('cmake ${PODS_TARGET_SRCROOT} -B ${TARGET_TEMP_DIR}', 'cmake "${PODS_TARGET_SRCROOT}" -B "${TARGET_TEMP_DIR}"')
        .gsub('cmake --build ${TARGET_TEMP_DIR}', 'cmake --build "${TARGET_TEMP_DIR}"')
    end
  end
  installer.pods_project.save
end

def configure_readany_mlx_bundle(target)
  bundle = target.shell_script_build_phases.find { |phase| phase.name == 'Bundle React Native code and images' }
  return unless bundle
  script = bundle.shell_script
  return if script.start_with?("export APP_VARIANT=mlx\n")
  script = script.lines.map do |line|
    command = line.strip
    if command.start_with?(96.chr) && command.end_with?(96.chr) && command.include?('react-native-xcode.sh')
      '"' + command + '"' + "\n"
    else
      line
    end
  end.join
  bundle.shell_script = "export APP_VARIANT=mlx\n" + script
end
