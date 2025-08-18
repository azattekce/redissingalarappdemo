using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using RedisChatApp.Models;

namespace RedisChatApp.Data
{
    public class AppDbContext : IdentityDbContext<ApplicationUser>
    {
        public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) {}

        public DbSet<FriendRequest> FriendRequests => Set<FriendRequest>();
    public DbSet<FriendBlock> FriendBlocks => Set<FriendBlock>();
    public DbSet<UserProfile> UserProfiles => Set<UserProfile>();
    public DbSet<ChatMessage> ChatMessages => Set<ChatMessage>();
    }
}
