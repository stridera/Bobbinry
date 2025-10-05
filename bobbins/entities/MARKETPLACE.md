# Entities - Universal Entity Management System

## 🎯 Overview

The **Entities bobbin** is a powerful, flexible system for managing all your worldbuilding entities without writing code. Create custom entity types with visual configuration, then manage your content with full CRUD operations, search, filtering, and smart previews.

## ✨ Key Features

### Visual Configuration
- **No YAML editing** - Everything is visual and intuitive
- **Drag-and-drop** field customization
- **Real-time preview** of your entity types
- **Template system** with 6 pre-built templates

### Pre-Configured Templates

1. **🧙 Characters** - RPG characters with class, level, stats, abilities
2. **✨ Spells** - Magic spells with school, level, components, effects
3. **🗺️ Locations** - Places with terrain, climate, population, landmarks
4. **⚔️ Items** - Equipment with type, rarity, properties, value
5. **🎭 Classes** - Character classes with hit dice, proficiencies, features
6. **⚜️ Factions** - Organizations with influence, territories, goals

### Powerful Field Types

Support for 9 different field types:
- **Text** - Single or multi-line text
- **Number** - With min/max validation
- **Select** - Dropdown with options
- **Multi-Select** - Multiple choices with checkboxes
- **Boolean** - Yes/no checkbox
- **Date** - Date picker
- **JSON** - Structured data editor
- **Rich Text** - Formatted content (TipTap ready)
- **Image** - Image URL with preview

### Flexible Layouts

Choose from 3 layout templates:
1. **Compact Card** - Space-efficient with small image
2. **Hero Image** - Prominent full-width hero image
3. **List & Details** - Two-column sidebar layout

### Smart Features

- **Auto-save** - Changes saved automatically after 2 seconds
- **Real-time search** - Find entities instantly
- **Tag filtering** - Multi-select tag filters
- **Sorting** - By name, created, or updated date
- **Pagination** - Handle large collections easily
- **Disambiguation** - Smart preview when multiple entities share a name
- **Dark mode** - Full dark theme support
- **Responsive** - Works on mobile, tablet, and desktop

## 🚀 Quick Start

### 1. Install the Bobbin

```bash
# From Bobbinry marketplace
Click "Install" on the Entities bobbin card
```

### 2. Create Your First Entity Type

1. Open **Entity Configuration** view
2. Browse the 6 pre-configured templates
3. Click a template to preview
4. Click "Use This Template"
5. Customize fields (add/remove/reorder)
6. Configure layout (template, image position, sections)
7. Click "Save Entity Type"

### 3. Create Entities

1. Select your entity type from the navigation panel
2. Click "New [Entity Type]"
3. Fill in the fields
4. Let auto-save do its magic!

## 📖 Use Cases

### RPG Worldbuilding
Manage characters, spells, locations, items, classes, and factions for your campaign.

### Story Writing
Track characters, locations, plot devices, and story elements.

### Game Development
Organize game entities, items, abilities, and game objects.

### Campaign Planning
Keep all your campaign content organized and searchable.

### Any Structured Content
The flexible system adapts to any type of structured data you need to manage.

## 🎨 Screenshots

### Configuration View
![Entity Type Configuration](screenshots/entities-config.png)
*Visual entity type configuration with drag-and-drop field customization*

### Entity Editor
![Entity Editor](screenshots/entities-editor.png)
*Entity editor with auto-save, validation, and dynamic layouts*

### Entity List
![Entity List](screenshots/entities-list.png)
*Browse, search, filter, and sort all your entities*

## 🔧 Technical Details

### Architecture
- **Native execution** for performance
- **Tier 1 JSONB storage** for dynamic entity types
- **TypeScript** strict mode throughout
- **React hooks** for state management
- **Full test coverage** (68 passing tests)

### Data Model
- `entity_type_definitions` - Core collection storing all entity type configurations
- Dynamic entity collections created at runtime based on your configuration
- Logical views for consistent querying regardless of storage tier

### Integration Points
- **Message bus** - Listens for text selection for entity preview
- **SDK** - Full CRUD operations through Bobbinry SDK
- **Compiler** - Generates dynamic collections automatically
- **ViewRouter** - Dynamic view routing based on entity type

## 📊 System Requirements

- **Bobbinry Shell**: v1.0.0 or higher
- **Storage**: Minimal - JSONB Tier 1 storage
- **Performance**: Optimized for <500ms response times

## 🎯 Roadmap

### Current Version (1.0.0)
- ✅ Visual configuration
- ✅ 6 pre-configured templates
- ✅ 9 field types
- ✅ 3 layout templates
- ✅ Full CRUD operations
- ✅ Search & filtering
- ✅ Smart preview with disambiguation

### Future Enhancements
- 🔜 TipTap rich text editor integration
- 🔜 Image upload to S3/R2
- 🔜 CSV import/export
- 🔜 Entity relationships
- 🔜 Custom validation rules
- 🔜 Activity history & versioning
- 🔜 Bulk operations
- 🔜 Advanced search filters

## 💡 Tips & Tricks

### Creating Effective Entity Types

1. **Start with a template** - Customize rather than build from scratch
2. **Use clear field names** - Make it obvious what goes in each field
3. **Add subtitle fields** - Help identify entities at a glance
4. **Organize with sections** - Group related fields together
5. **Choose the right layout** - Match the layout to your content type

### Performance

- Entity types are cached for fast loading
- Search is indexed for quick results
- Pagination prevents slowdowns with large collections
- Auto-save reduces write operations

### Best Practices

- Use **tags** liberally for easy filtering
- Set **required fields** for critical data
- Add **default values** for common cases
- Use **multi-select** for categorization
- Enable **image previews** for visual entities

## 📞 Support

### Documentation
- **README.md** - Complete implementation guide
- **QUICKSTART.md** - Quick start for developers
- **IMPLEMENTATION_COMPLETE.md** - Technical details

### Getting Help
- Check the [Bobbinry Documentation](https://docs.bobbinry.com)
- Visit [GitHub Issues](https://github.com/bobbins/entities/issues)
- Join the [Bobbinry Discord](https://discord.gg/bobbinry)

## 📜 License

MIT License - Free to use, modify, and distribute.

## 🙏 Credits

Created by the Bobbinry Core team.

Built with:
- React
- TypeScript
- Tailwind CSS
- Bobbinry SDK

---

**Ready to manage your entities the easy way? Install now!** 🚀
