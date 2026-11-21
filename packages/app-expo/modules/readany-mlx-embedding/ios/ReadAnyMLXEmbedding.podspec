Pod::Spec.new do |s|
  s.name = 'ReadAnyMLXEmbedding'
  s.version = '0.1.0'
  s.summary = 'Expo bridge for the optional ReadAny MLX embedding engine'
  s.license = 'GPL-3.0-or-later'
  s.author = 'ReadAny'
  s.homepage = 'https://github.com/codedogQBY/ReadAny'
  s.platforms = { :ios => '15.1' }
  s.swift_version = '5.9'
  s.source = { :path => '.' }
  s.static_framework = true
  s.source_files = 'ReadAnyMLXEmbeddingModule.swift'
  s.dependency 'ExpoModulesCore'
end
