Pod::Spec.new do |s|
  s.name           = 'TailmanceEdgeAi'
  s.version        = '0.1.0'
  s.summary        = 'Tailmance verified on-device inference bridge'
  s.description    = 'Local Expo native bridge for hash-verified Core ML and Vision inference.'
  s.author         = 'Yekta Ozel'
  # This pod is consumed as a local Expo module. Its source is the checked-out Tailmance tree,
  # not an invented remote repository.
  s.homepage       = "file://#{File.expand_path('../../..', __dir__)}"
  s.platforms      = { :ios => '15.0' }
  s.source         = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'CoreML', 'Vision', 'CryptoKit'
  s.source_files = '**/*.{h,m,mm,swift}'
  s.swift_version = '5.9'
end
