using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace RedisChatApp.Models
{
    public enum FriendRequestStatus { Pending, Accepted, Rejected }

    public class FriendRequest
    {
        [Key]
        public int Id { get; set; }
        [Required]
        public string FromUserId { get; set; } = default!;
        [Required]
        public string ToUserId { get; set; } = default!;
        public FriendRequestStatus Status { get; set; } = FriendRequestStatus.Pending;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }
}
