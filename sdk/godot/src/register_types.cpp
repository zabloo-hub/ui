// GDExtension entry point: registers `ZablooView` with Godot and nothing else.

#include "register_types.h"

#include <gdextension_interface.h>
#include <godot_cpp/core/class_db.hpp>
#include <godot_cpp/core/defs.hpp>
#include <godot_cpp/godot.hpp>

#include "zabloo_view.h"

using namespace godot;

void initialize_zabloo_module(ModuleInitializationLevel level) {
  if (level != MODULE_INITIALIZATION_LEVEL_SCENE) return;
  GDREGISTER_CLASS(ZablooView);
}

void uninitialize_zabloo_module(ModuleInitializationLevel level) {
  (void)level;
}

extern "C" {
GDExtensionBool GDE_EXPORT zabloo_library_init(GDExtensionInterfaceGetProcAddress get_proc_address,
                                               const GDExtensionClassLibraryPtr library,
                                               GDExtensionInitialization *initialization) {
  GDExtensionBinding::InitObject init(get_proc_address, library, initialization);
  init.register_initializer(initialize_zabloo_module);
  init.register_terminator(uninitialize_zabloo_module);
  init.set_minimum_library_initialization_level(MODULE_INITIALIZATION_LEVEL_SCENE);
  return init.init();
}
}
